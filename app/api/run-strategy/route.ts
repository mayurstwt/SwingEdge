import { analyzeStock } from '@/lib/strategy';
import { getSupabase, type TradeRow } from '@/lib/supabase';
import { executeAutoBuy, executeAutoSell } from '@/lib/wallet';
import STOCKS_DATA from '@/data/stocks.json';
import { fetchHistoricalSeries } from '@/lib/trading/market-data';
import { deriveStrategyContext } from '@/lib/trading/backtest';
import { calculatePositionSize, resolveRiskTier } from '@/lib/trading/risk';
import { buildLiveEquityCurve, calculateMaxDrawdownPct } from '@/lib/trading/performance';
import type { StrategyPerformanceSnapshot } from '@/lib/trading/types';

const PRIORITY_STOCKS = STOCKS_DATA.slice(0, 20);

// 🔥 Increased capacity
const MAX_OPEN_TRADES = 10;
const MAX_CAPITAL_USAGE = 0.9;
const ATR_TRAIL_MULTIPLIER = 1.8;

// 🔥 New confidence threshold
const MIN_CONFIDENCE = 55;

function toPerformanceMap(rows: Array<Record<string, unknown>>): Map<string, StrategyPerformanceSnapshot> {
  return new Map(
    rows.map((row) => {
      const entryType = String(row.entry_type) as StrategyPerformanceSnapshot['entryType'];

      return [
        entryType,
        {
          entryType,
          avgProfit: Number(row.avg_profit ?? 0),
          winRate: Number(row.win_rate ?? 0),
          tradesCount: Number(row.trades_count ?? 0),
          totalProfit: Number(row.total_profit ?? 0),
          dynamicScoreThreshold: Number(row.dynamic_score_threshold ?? 60),
          capitalWeight: Number(row.capital_weight ?? 1),
          enabled: Boolean(row.enabled ?? true),
        },
      ];
    })
  );
}

export async function POST(req: Request) {
  const supabase = getSupabase();
  const todayStr = new Date().toISOString().split('T')[0];

  const results = {
    processed: 0,
    auto_buys: [] as string[],
    auto_sells: [] as string[],
    logs: [] as string[],
  };

  try {
    const body = await req.json().catch(() => ({}));
    const bypassMarketFilter = !!body.bypassMarketFilter;

    const [{ data: wallet }, { data: openTrades }, { data: closedTrades }, { data: strategyRows }] = await Promise.all([
      supabase.from('wallet').select('balance').eq('id', 1).single(),
      supabase.from('trades').select('*').eq('status', 'OPEN'),
      supabase.from('trades').select('*').eq('status', 'CLOSED').limit(50),
      supabase.from('strategy_performance').select('*'),
    ]);

    const openTradeRows = (openTrades ?? []) as TradeRow[];
    let currentBalance = Number(wallet?.balance ?? 0);

    const performanceMap = toPerformanceMap(strategyRows ?? []);

    const recentClosed = (closedTrades ?? []) as TradeRow[];
    const recentWinRate =
      recentClosed.length === 0
        ? 50
        : (recentClosed.filter((t) => Number(t.profit_loss ?? 0) > 0).length / recentClosed.length) * 100;

    const drawdownCurve = buildLiveEquityCurve(recentClosed, 50000);
    const liveDrawdown = calculateMaxDrawdownPct(drawdownCurve);

    const riskTier = resolveRiskTier(recentWinRate, liveDrawdown);

    let marketBullish = true;

    try {
      const niftySeries = await fetchHistoricalSeries('^NSEI', { range: '1y' });
      const niftyAnalysis = analyzeStock(
        niftySeries.candles.map((c) => c.close),
        niftySeries.candles.map((c) => c.high),
        niftySeries.candles.map((c) => c.low),
        niftySeries.candles.map((c) => c.volume)
      );

      marketBullish = niftyAnalysis.trend === 'UPTREND';

      if (!marketBullish) {
        results.logs.push(`⚠️ Market weak (${niftyAnalysis.trend}) → reducing confidence`);
      }

    } catch {
      results.logs.push('NIFTY fetch failed → ignoring market filter');
    }

    for (const stockInfo of PRIORITY_STOCKS) {
      try {
        const series = await fetchHistoricalSeries(stockInfo.symbol, { range: '1y' });
        const candles = series.candles;
        if (candles.length < 30) continue;

        const analysis = analyzeStock(
          candles.map((c) => c.close),
          candles.map((c) => c.high),
          candles.map((c) => c.low),
          candles.map((c) => c.volume)
        );

        const latestCandle = candles[candles.length - 1];
        const context = deriveStrategyContext(analysis, performanceMap);

        let confidenceScore = analysis.score;

        // 🔥 Soft adjustments instead of hard filters
        if (!marketBullish) confidenceScore -= 10;
        if (context.volumeStrength === 'WEAK') confidenceScore -= 5;
        if (analysis.decision === 'HOLD') confidenceScore -= 5;

        const existingTrade = openTradeRows.find((t) => t.symbol === stockInfo.symbol);

        if (!existingTrade) {
          if (confidenceScore < MIN_CONFIDENCE) {
            results.logs.push(`${stockInfo.symbol}: skipped (low confidence ${confidenceScore})`);
            continue;
          }

          const capitalInUse = openTradeRows.reduce(
            (sum, t) => sum + Number(t.buy_price) * Number(t.quantity),
            0
          );

          const totalEquity = currentBalance + capitalInUse;
          const capitalUsagePct = totalEquity === 0 ? 0 : capitalInUse / totalEquity;

          if (openTradeRows.length >= MAX_OPEN_TRADES) {
            results.logs.push(`${stockInfo.symbol}: skipped (max trades reached)`);
            continue;
          }

          if (capitalUsagePct >= MAX_CAPITAL_USAGE) {
            results.logs.push(`${stockInfo.symbol}: skipped (capital limit)`);
            continue;
          }

          const sizing = calculatePositionSize({
            availableCash: currentBalance,
            currentEquity: totalEquity,
            price: latestCandle.close,
            stopLoss: analysis.stopLoss,
            riskTier,
            strategyWeight: context.strategyWeight,
            capitalLimitPct: MAX_CAPITAL_USAGE - capitalUsagePct,
          });

          if (sizing.quantity <= 0) {
            results.logs.push(`${stockInfo.symbol}: sizing failed`);
            continue;
          }

          const buyResult = await executeAutoBuy(
            stockInfo.symbol,
            series.shortName,
            latestCandle.close,
            analysis.stopLoss,
            analysis.target,
            analysis.reason,
            stockInfo.sector,
            {
              quantity: sizing.quantity,
              entryType: context.entryType,
              marketCondition: context.marketCondition,
              volumeStrength: context.volumeStrength,
              riskReward: analysis.riskReward,
              strategyWeight: context.strategyWeight,
              riskTier,
              entryScore: confidenceScore,
            }
          );

          if (buyResult.success) {
            currentBalance -= Number(buyResult.cost ?? 0);
            results.auto_buys.push(stockInfo.symbol);
            results.logs.push(`✅ ${stockInfo.symbol}: BUY executed (score ${confidenceScore})`);
          }
        }

        results.processed++;

      } catch (err: any) {
        results.logs.push(`${stockInfo.symbol}: ${err.message}`);
      }
    }

    return Response.json(results);

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}