/**
 * /api/run-strategy — SwingEdge Automation Brain
 *
 * Governance Rules (README §3):
 *  - BUY threshold: score >= 70  (§3.1)
 *  - Max capital usage: 90%       (§3.2)
 *  - Trailing stop: 1.5x ATR     (§3.3)
 *  - Partial exit at Target 1     (§3.3)
 *  - Never use anon Supabase key for writes (use admin/service-role) (§6.3)
 */

import { analyzeStock } from '@/lib/strategy';
import { getSupabaseAdmin, type TradeRow } from '@/lib/supabase';
import { executeAutoBuy, executeAutoSell } from '@/lib/wallet';
import STOCKS_DATA from '@/data/stocks.json';
import { fetchHistoricalSeries } from '@/lib/trading/market-data';
import { deriveStrategyContext } from '@/lib/trading/backtest';
import { calculatePositionSize, resolveRiskTier } from '@/lib/trading/risk';
import { buildLiveEquityCurve, calculateMaxDrawdownPct, summarizeStrategyPerformance } from '@/lib/trading/performance';
import { calculateATR } from '@/lib/indicators';
import type { StrategyPerformanceSnapshot, SimulatedTrade } from '@/lib/trading/types';

const PRIORITY_STOCKS = STOCKS_DATA.slice(0, 20);

// ── README §3 constants ─────────────────────────────────────────────────────
const MAX_OPEN_TRADES     = 10;
const MAX_CAPITAL_USAGE   = 0.90;   // 90 % capital limit
const ATR_TRAIL_MULTIPLIER = 1.5;   // README §3.3
const PARTIAL_EXIT_PCT    = 0.50;   // book 50 % at Target 1 (README §3.3)

/** README §3.1 — BUY ≥ 70 | HOLD 50-69 | AVOID < 50. Never lower MIN_BUY_SCORE. */
const MIN_BUY_SCORE = 70;

// ── helper ──────────────────────────────────────────────────────────────────
function scoreToDecision(score: number): 'BUY' | 'HOLD' | 'AVOID' {
  if (score >= MIN_BUY_SCORE) return 'BUY';
  if (score >= 50)            return 'HOLD';
  return 'AVOID';
}

function toPerformanceMap(
  rows: Array<Record<string, unknown>>
): Map<string, StrategyPerformanceSnapshot> {
  return new Map(
    rows.map((row) => {
      const entryType = String(row.entry_type) as StrategyPerformanceSnapshot['entryType'];
      return [
        entryType,
        {
          entryType,
          avgProfit:             Number(row.avg_profit              ?? 0),
          winRate:               Number(row.win_rate                ?? 0),
          tradesCount:           Number(row.trades_count            ?? 0),
          totalProfit:           Number(row.total_profit            ?? 0),
          dynamicScoreThreshold: Number(row.dynamic_score_threshold ?? 65),
          capitalWeight:         Number(row.capital_weight          ?? 1),
          enabled:               Boolean(row.enabled               ?? true),
        },
      ];
    })
  );
}

// ── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  // ✅ Always use the admin client in API routes — the anon key is blocked by RLS
  const supabase = getSupabaseAdmin();

  const todayStr = new Date().toISOString().split('T')[0];

  const results = {
    processed:  0,
    auto_buys:  [] as string[],
    auto_sells: [] as string[],
    logs:       [] as string[],
  };

  try {
    const body = await req.json().catch(() => ({}));
    const bypassMarketFilter: boolean = !!body.bypassMarketFilter;

    // ── 1. Load portfolio state ─────────────────────────────────────────────
    const [
      { data: wallet },
      { data: openTrades },
      { data: closedTrades },
      { data: strategyRows },
    ] = await Promise.all([
      supabase.from('wallet').select('balance').eq('id', 1).single(),
      supabase.from('trades').select('*').eq('status', 'OPEN'),
      supabase.from('trades').select('*').eq('status', 'CLOSED').limit(100),
      supabase.from('strategy_performance').select('*'),
    ]);

    let openTradeRows = (openTrades ?? []) as TradeRow[];
    let currentBalance = Number(wallet?.balance ?? 0);
    const performanceMap = toPerformanceMap(strategyRows ?? []);

    const recentClosed = (closedTrades ?? []) as TradeRow[];
    const recentWinRate =
      recentClosed.length === 0
        ? 50
        : (recentClosed.filter((t) => Number(t.profit_loss ?? 0) > 0).length /
           recentClosed.length) * 100;

    const equityCurve = buildLiveEquityCurve(recentClosed, 50000);
    const liveDrawdown = calculateMaxDrawdownPct(equityCurve);
    const riskTier = resolveRiskTier(recentWinRate, liveDrawdown);

    results.logs.push(
      `📊 Portfolio: balance=₹${currentBalance.toFixed(0)}, openTrades=${openTradeRows.length}, winRate=${recentWinRate.toFixed(1)}%, drawdown=${liveDrawdown.toFixed(1)}%, riskTier=${riskTier}`
    );

    // ── 2. NIFTY 50 market filter ───────────────────────────────────────────
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
      results.logs.push(
        marketBullish
          ? '✅ Market: NIFTY UPTREND — normal scoring'
          : `⚠️ Market: NIFTY ${niftyAnalysis.trend} — −10 pts on all stocks`
      );
    } catch {
      results.logs.push('⚠️ NIFTY fetch failed → market filter skipped');
    }

    // ── 3. Manage existing open trades (trailing stop + exits) ─────────────
    const closedThisRun: TradeRow[] = [];

    for (const trade of openTradeRows) {
      try {
        const series = await fetchHistoricalSeries(trade.symbol, { range: '1y' });
        const candles = series.candles;
        if (candles.length < 30) continue;

        const latestCandle = candles[candles.length - 1];
        const currentPrice = latestCandle.close;

        // Compute current ATR for trailing stop
        const currentATR = calculateATR(
          candles.map((c) => c.high),
          candles.map((c) => c.low),
          candles.map((c) => c.close),
          14
        );

        const newTrailingStop = parseFloat(
          (currentPrice - ATR_TRAIL_MULTIPLIER * currentATR).toFixed(2)
        );
        const activeStop = Math.max(
          Number(trade.stop_loss ?? 0),
          newTrailingStop
        );

        // Update trailing stop if it improved
        if (newTrailingStop > Number(trade.stop_loss ?? 0)) {
          await supabase
            .from('trades')
            .update({ stop_loss: newTrailingStop, highest_price: Math.max(Number(trade.highest_price ?? trade.buy_price), currentPrice) })
            .eq('id', trade.id);
          results.logs.push(
            `📈 ${trade.symbol}: trailing stop → ₹${newTrailingStop} (was ₹${trade.stop_loss})`
          );
        }

        // README §3.3 — Partial exit: book 50 % at Target 1
        const target = Number(trade.target ?? 0);
        const hasTarget = target > 0;
        const alreadyPartialled = (trade.partial_exit_count ?? 0) > 0;

        if (hasTarget && !alreadyPartialled && currentPrice >= target) {
          const partialQty = Math.max(1, Math.floor(trade.quantity * PARTIAL_EXIT_PCT));
          const partialResult = await executeAutoSell(trade, currentPrice, 'TARGET_1_HIT', {
            quantity: partialQty,
            partial: true,
          });
          if (partialResult.success) {
            results.logs.push(
              `🎯 ${trade.symbol}: Partial exit ${partialQty} shares @ ₹${currentPrice} (Target 1 hit, P&L=₹${partialResult.pnl.toFixed(0)})`
            );
            results.auto_sells.push(`${trade.symbol}(partial)`);
            currentBalance += partialResult.proceeds;
          }
          continue; // re-evaluate next run
        }

        // Full exit: stop-loss hit
        if (currentPrice <= activeStop) {
          const sellResult = await executeAutoSell(trade, currentPrice, 'TRAILING_STOP_HIT');
          if (sellResult.success) {
            results.logs.push(
              `🛑 ${trade.symbol}: STOP HIT @ ₹${currentPrice} | P&L = ₹${sellResult.pnl.toFixed(0)}`
            );
            results.auto_sells.push(trade.symbol);
            currentBalance += sellResult.proceeds;
            closedThisRun.push(trade);
          }
          continue;
        }

        results.logs.push(
          `🔍 ${trade.symbol}: HOLD — price=₹${currentPrice} stop=₹${activeStop.toFixed(2)} target=₹${target}`
        );
      } catch (err: unknown) {
        results.logs.push(
          `${trade.symbol} (trade mgmt): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Refresh open trades list after any exits this run
    if (closedThisRun.length > 0) {
      const { data: refreshed } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'OPEN');
      openTradeRows = (refreshed ?? openTradeRows) as TradeRow[];
    }

    // ── 4. Update adaptive strategy_performance table ──────────────────────
    if (closedThisRun.length > 0) {
      const { data: allClosed } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'CLOSED')
        .limit(200);

      if (allClosed && allClosed.length > 0) {
        // Map TradeRow → SimulatedTrade shape (only fields needed by summarizeStrategyPerformance)
        const tradeLog: Array<Pick<SimulatedTrade, 'entryType' | 'netPnl' | 'riskReward'>> =
          (allClosed as TradeRow[]).map((t) => ({
            entryType: (t.entry_type ?? 'MOMENTUM') as SimulatedTrade['entryType'],
            netPnl:    Number(t.profit_loss ?? 0),
            riskReward: t.risk_reward ?? null,
          }));

        const snapshots = summarizeStrategyPerformance(tradeLog);

        for (const snap of snapshots) {
          await supabase.from('strategy_performance').upsert(
            {
              entry_type:              snap.entryType,
              avg_profit:              snap.avgProfit,
              win_rate:                snap.winRate,
              trades_count:            snap.tradesCount,
              total_profit:            snap.totalProfit,
              dynamic_score_threshold: snap.dynamicScoreThreshold,
              capital_weight:          snap.capitalWeight,
              enabled:                 snap.enabled,
              updated_at:              new Date().toISOString(),
            },
            { onConflict: 'entry_type' }
          );
        }
        results.logs.push(`🧠 Adaptive: updated strategy_performance for ${snapshots.length} entry types`);
      }
    }

    // ── 5. Scan for new entry signals ───────────────────────────────────────
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

        // Adjusted confidence score — build adjustment explanation for the reason field
        const rawScore = analysis.score;
        let confidenceScore = rawScore;
        const adjustments: string[] = [];

        if (!marketBullish && !bypassMarketFilter) {
          confidenceScore -= 10;
          adjustments.push('−10 (bear mkt)');
        }
        confidenceScore = Math.max(0, confidenceScore);

        // README §3.1 — single source of truth for decision label
        const displayDecision = scoreToDecision(confidenceScore);

        const adjustmentStr = adjustments.length > 0 ? ` [raw ${rawScore}${adjustments.join('')}]` : '';
        const signalReason =
          displayDecision === 'BUY'
            ? `${analysis.reason}${adjustmentStr}`
            : `${analysis.reason} — score ${confidenceScore}${adjustmentStr} (need ≥${MIN_BUY_SCORE} to B...)`;

        signalsToUpsert.push({
          symbol:     stockInfo.symbol,
          short_name: series.shortName,
          decision:   displayDecision,
          score:      confidenceScore,
          confidence: analysis.confidence,
          price:      latestCandle.close,
          stop_loss:  analysis.stopLoss,
          target:     analysis.target,
          rsi:        analysis.rsi,
          trend:      analysis.trend,
          change_pct: analysis.changePercent,
          reason:     signalReason,
          run_date:   todayStr,
          updated_at: new Date().toISOString(),
        });

        results.processed++;
        results.logs.push(`${stockInfo.symbol}: raw=${rawScore} → adjusted=${confidenceScore} → ${displayDecision}`);

        // ── 6. Execute auto-buy if conditions are met ──────────────────────
        const existingTrade = openTradeRows.find((t) => t.symbol === stockInfo.symbol);
        if (existingTrade) continue;          // already in trade
        if (displayDecision !== 'BUY') continue; // not a BUY signal

        if (openTradeRows.length >= MAX_OPEN_TRADES) {
          results.logs.push(`${stockInfo.symbol}: skipped (${openTradeRows.length}/${MAX_OPEN_TRADES} trades open)`);
          continue;
        }

        const capitalInUse = openTradeRows.reduce(
          (sum, t) => sum + Number(t.buy_price) * Number(t.quantity),
          0
        );
        const totalEquity      = currentBalance + capitalInUse;
        const capitalUsagePct  = totalEquity === 0 ? 0 : capitalInUse / totalEquity;

        if (capitalUsagePct >= MAX_CAPITAL_USAGE) {
          results.logs.push(
            `${stockInfo.symbol}: skipped (capital at ${(capitalUsagePct * 100).toFixed(1)}% ≥ ${MAX_CAPITAL_USAGE * 100}%)`
          );
          continue;
        }

        const sizing = calculatePositionSize({
          availableCash:   currentBalance,
          currentEquity:   totalEquity,
          price:           latestCandle.close,
          stopLoss:        analysis.stopLoss,
          riskTier,
          strategyWeight:  context.strategyWeight,
          capitalLimitPct: MAX_CAPITAL_USAGE - capitalUsagePct,
        });

        if (sizing.quantity <= 0) {
          results.logs.push(`${stockInfo.symbol}: skipped (position sizing: qty=0)`);
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
            quantity:        sizing.quantity,
            entryType:       context.entryType,
            marketCondition: context.marketCondition,
            volumeStrength:  context.volumeStrength,
            riskReward:      analysis.riskReward,
            strategyWeight:  context.strategyWeight,
            riskTier,
            entryScore:      confidenceScore,
          }
        );

        if (buyResult.success) {
          currentBalance -= Number(buyResult.cost ?? 0);
          results.auto_buys.push(stockInfo.symbol);
          results.logs.push(
            `✅ ${stockInfo.symbol}: BUY ${sizing.quantity} shares @ ₹${latestCandle.close} (score=${confidenceScore}, tier=${riskTier})`
          );
        } else {
          results.logs.push(`❌ ${stockInfo.symbol}: buy failed`);
        }

      } catch (err: unknown) {
        results.logs.push(
          `${stockInfo.symbol}: ERROR — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── 7. Persist signals to DB ─────────────────────────────────────────────
    if (signalsToUpsert.length > 0) {
      const { error: signalError } = await supabase
        .from('signals')
        .upsert(signalsToUpsert, { onConflict: 'symbol, run_date' });

      results.logs.push(
        signalError
          ? `⚠️ Signal upsert failed: ${signalError.message}`
          : `📡 Saved ${signalsToUpsert.length} signals to DB (${todayStr})`
      );
    }

    return Response.json(results);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}