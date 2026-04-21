import { analyzeStock } from '@/lib/strategy';
import { getSupabase, type TradeRow } from '@/lib/supabase';
import { executeAutoBuy } from '@/lib/wallet';
import STOCKS_DATA from '@/data/stocks.json';
import { fetchHistoricalSeries } from '@/lib/trading/market-data';
import { deriveStrategyContext } from '@/lib/trading/backtest';
import { calculatePositionSize, resolveRiskTier } from '@/lib/trading/risk';
import { buildLiveEquityCurve, calculateMaxDrawdownPct } from '@/lib/trading/performance';
import type { StrategyPerformanceSnapshot } from '@/lib/trading/types';

const PRIORITY_STOCKS = STOCKS_DATA.slice(0, 20);

// --- Constants (per README governance rules) ---
const MAX_OPEN_TRADES = 10;
const MAX_CAPITAL_USAGE = 0.9;

/**
 * README Rule §3.1: BUY threshold is 70. Never lower this without updating README.
 */
const MIN_CONFIDENCE = 70;

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
          dynamicScoreThreshold: Number(row.dynamic_score_threshold ?? 65),
          capitalWeight: Number(row.capital_weight ?? 1),
          enabled: Boolean(row.enabled ?? true),
        },
      ];
    })
  );
}

/**
 * Derive the signal decision label from the adjusted confidence score.
 * This is the single source of truth for what gets displayed in the dashboard.
 * README Rule §3.1: BUY ≥ 70 | HOLD 50–69 | AVOID < 50
 */
function scoreToDecision(score: number): 'BUY' | 'HOLD' | 'AVOID' {
  if (score >= MIN_CONFIDENCE) return 'BUY';
  if (score >= 50) return 'HOLD';
  return 'AVOID';
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

    const [
      { data: wallet },
      { data: openTrades },
      { data: closedTrades },
      { data: strategyRows },
    ] = await Promise.all([
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

    // --- Market Filter (NIFTY 50) ---
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
        results.logs.push(`⚠️ Market weak (${niftyAnalysis.trend}) → −10 pts on all stocks`);
      }
    } catch {
      results.logs.push('NIFTY fetch failed → market filter skipped');
    }

    // FIX: Declare signalsToUpsert BEFORE the loop (was missing — caused silent ReferenceError)
    const signalsToUpsert: Array<Record<string, unknown>> = [];

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

        // --- Score Adjustments ---
        let confidenceScore = analysis.score;
        if (!marketBullish) confidenceScore -= 10;
        if (context.volumeStrength === 'WEAK') confidenceScore -= 5;
        confidenceScore = Math.max(0, confidenceScore);

        // --- Decision from adjusted score (single source of truth, per README §3.1) ---
        const displayDecision = scoreToDecision(confidenceScore);

        const signalReason =
          displayDecision === 'BUY'
            ? analysis.reason
            : `${analysis.reason} — score ${confidenceScore} (need ≥${MIN_CONFIDENCE} for BUY)`;

        // FIX: Use correct field name `changePercent` (not `changePct` which does not exist on AnalysisResult)
        signalsToUpsert.push({
          symbol: stockInfo.symbol,
          short_name: series.shortName,
          decision: displayDecision,
          score: confidenceScore,
          confidence: analysis.confidence,
          price: latestCandle.close,
          stop_loss: analysis.stopLoss,
          target: analysis.target,
          rsi: analysis.rsi,
          trend: analysis.trend,
          change_pct: analysis.changePercent,
          reason: signalReason,
          run_date: todayStr,
          updated_at: new Date().toISOString(),
        });

        results.processed++;
        results.logs.push(`${stockInfo.symbol}: score=${confidenceScore} → ${displayDecision}`);

        // --- Auto-Trade: only execute if BUY and no existing open trade ---
        const existingTrade = openTradeRows.find((t) => t.symbol === stockInfo.symbol);
        if (existingTrade || displayDecision !== 'BUY') {
          if (displayDecision !== 'BUY') {
            results.logs.push(`${stockInfo.symbol}: skipped trade (${displayDecision}, score=${confidenceScore})`);
          }
          continue;
        }

        if (openTradeRows.length >= MAX_OPEN_TRADES) {
          results.logs.push(`${stockInfo.symbol}: skipped (max ${MAX_OPEN_TRADES} trades open)`);
          continue;
        }

        const capitalInUse = openTradeRows.reduce(
          (sum, t) => sum + Number(t.buy_price) * Number(t.quantity),
          0
        );
        const totalEquity = currentBalance + capitalInUse;
        const capitalUsagePct = totalEquity === 0 ? 0 : capitalInUse / totalEquity;

        if (capitalUsagePct >= MAX_CAPITAL_USAGE) {
          results.logs.push(`${stockInfo.symbol}: skipped (capital limit ${(capitalUsagePct * 100).toFixed(1)}%)`);
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
          results.logs.push(`${stockInfo.symbol}: skipped (position sizing failed)`);
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
          results.logs.push(`✅ ${stockInfo.symbol}: BUY executed @ ₹${latestCandle.close} (score=${confidenceScore})`);
        }

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.logs.push(`${stockInfo.symbol}: ERROR — ${message}`);
      }
    }

    // --- Persist all signals to DB ---
    if (signalsToUpsert.length > 0) {
      const { error: signalError } = await supabase
        .from('signals')
        .upsert(signalsToUpsert, { onConflict: 'symbol, run_date' });

      if (signalError) {
        results.logs.push(`⚠️ Signal upsert failed: ${signalError.message}`);
      } else {
        results.logs.push(`📡 Saved ${signalsToUpsert.length} signals to DB (${todayStr})`);
      }
    }

    return Response.json(results);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}