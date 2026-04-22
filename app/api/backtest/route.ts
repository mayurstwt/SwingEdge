import { createHash } from 'crypto';
import STOCKS_DATA from '@/data/stocks.json';
import { getSupabase } from '@/lib/supabase';
import { fetchHistoricalSeries, sanitizeHistoricalSeries } from '@/lib/trading/market-data';
import { runBacktest } from '@/lib/trading/backtest';
import type { BacktestRequestPayload } from '@/lib/trading/types';

// Allow up to 5 minutes for the backtest route (Netlify/Vercel edge)
export const maxDuration = 300;

const DEFAULT_SYMBOLS = STOCKS_DATA.slice(0, 20).map((stock) => stock.symbol);


function stableHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function filterSeriesByDate(
  series: Awaited<ReturnType<typeof sanitizeHistoricalSeries>>,
  startDate?: string,
  endDate?: string
) {
  return series
    .map((item) => ({
      ...item,
      candles: item.candles.filter((candle) => {
        if (startDate && candle.date < startDate) {
          return false;
        }
        if (endDate && candle.date > endDate) {
          return false;
        }
        return true;
      }),
    }))
    .filter((item) => item.candles.length >= 30);
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get('runId');

    if (runId) {
      const [runRes, tradesRes] = await Promise.all([
        supabase.from('backtest_runs').select('*').eq('id', runId).single(),
        supabase.from('backtest_trades').select('*').eq('run_id', runId).order('entry_date', { ascending: true }),
      ]);

      return Response.json({
        run: runRes.data,
        trades: tradesRes.data ?? [],
      });
    }

    const { data } = await supabase
      .from('backtest_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    return Response.json({ runs: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load backtests';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase();
    const body = (await req.json()) as BacktestRequestPayload;
    const symbols = (body.symbols && body.symbols.length > 0 ? body.symbols : DEFAULT_SYMBOLS).slice(0, body.settings?.symbolLimit ?? 20);
    const requestPayload = {
      name: body.name ?? 'System Backtest',
      symbols,
      initialCapital: body.initialCapital ?? 50000,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      settings: body.settings ?? {},
      historicalFingerprint: body.historicalData?.map((item) => ({
        symbol: item.symbol,
        candles: item.candles.length,
        first: item.candles[0]?.date,
        last: item.candles[item.candles.length - 1]?.date,
      })) ?? null,
    };
    const requestHash = stableHash(requestPayload);

    if (!body.forceRefresh) {
      const { data: existing } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('request_hash', requestHash)
        .single();

      if (existing) {
        const { data: trades } = await supabase
          .from('backtest_trades')
          .select('*')
          .eq('run_id', existing.id)
          .order('entry_date', { ascending: true });

        return Response.json({
          cached: true,
          run: existing,
          trades: trades ?? [],
        });
      }
    }

    let rawHistoricalData: Awaited<ReturnType<typeof sanitizeHistoricalSeries>>;
    if (body.historicalData && body.historicalData.length > 0) {
      rawHistoricalData = sanitizeHistoricalSeries(body.historicalData);
    } else {
      // Fetch in parallel but don't let one failure kill the whole backtest
      const settled = await Promise.allSettled(
        symbols.map((symbol) => fetchHistoricalSeries(symbol, { range: '2y' }))
      );
      const succeeded = settled
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchHistoricalSeries>>> => r.status === 'fulfilled')
        .map((r) => r.value);
      rawHistoricalData = sanitizeHistoricalSeries(succeeded);
    }
    const historicalData = filterSeriesByDate(rawHistoricalData, body.startDate, body.endDate);

    if (historicalData.length === 0) {
      return Response.json({ error: 'No valid historical series available for the requested window' }, { status: 400 });
    }

    const { data: strategyPerformanceRows } = await supabase
      .from('strategy_performance')
      .select('*')
      .order('total_profit', { ascending: false });

    const result = runBacktest(
      historicalData,
      (strategyPerformanceRows ?? []).map((row) => ({
        entryType: row.entry_type,
        avgProfit: Number(row.avg_profit),
        winRate: Number(row.win_rate),
        tradesCount: Number(row.trades_count),
        totalProfit: Number(row.total_profit),
        dynamicScoreThreshold: Number(row.dynamic_score_threshold),
        capitalWeight: Number(row.capital_weight),
        enabled: Boolean(row.enabled),
      })),
      {
        initialCapital: body.initialCapital ?? 50000,
        ...body.settings,
      }
    );

    const firstSeries = historicalData[0];
    const lastCandle = firstSeries?.candles[firstSeries.candles.length - 1];
    const { data: insertedRun, error: runError } = await supabase
      .from('backtest_runs')
      .insert({
        name: requestPayload.name,
        request_hash: requestHash,
        symbols,
        start_date: firstSeries?.candles[0]?.date ?? null,
        end_date: lastCandle?.date ?? null,
        initial_capital: result.initialCapital,
        final_equity: result.finalEquity,
        total_return_pct: result.totalReturnPct,
        max_drawdown_pct: result.maxDrawdownPct,
        win_rate: result.winRate,
        avg_risk_reward: result.avgRiskReward,
        total_trades: result.totalTrades,
        settings: result.settings,
        equity_curve: result.equityCurve,
        drawdown_curve: result.drawdownCurve,
      })
      .select('*')
      .single();

    if (runError || !insertedRun) {
      throw new Error(runError?.message ?? 'Failed to persist backtest run');
    }

    if (result.tradeLog.length > 0) {
      await supabase.from('backtest_trades').insert(
        result.tradeLog.map((trade) => ({
          run_id: insertedRun.id,
          symbol: trade.symbol,
          short_name: trade.shortName,
          sector: trade.sector,
          entry_date: trade.entryDate,
          exit_date: trade.exitDate,
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          quantity: trade.quantity,
          gross_pnl: trade.grossPnl,
          net_pnl: trade.netPnl,
          exit_reason: trade.exitReason,
          entry_type: trade.entryType,
          risk_reward: trade.riskReward,
          partial_exit_count: trade.partialExitCount,
          bars_held: trade.barsHeld,
          strategy_score: trade.strategyScore,
          risk_tier: trade.riskTier,
        }))
      );
    }

    if (result.strategyBreakdown.length > 0) {
      await supabase.from('strategy_performance').upsert(
        result.strategyBreakdown.map((row) => ({
          entry_type: row.entryType,
          avg_profit: row.avgProfit,
          win_rate: row.winRate,
          trades_count: row.tradesCount,
          total_profit: row.totalProfit,
          dynamic_score_threshold: row.dynamicScoreThreshold,
          capital_weight: row.capitalWeight,
          enabled: row.enabled,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'entry_type' }
      );
    }

    return Response.json({
      cached: false,
      run: insertedRun,
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Backtest failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
