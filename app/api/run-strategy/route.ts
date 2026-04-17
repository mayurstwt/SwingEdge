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
const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.7;
const ATR_TRAIL_MULTIPLIER = 1.8;

function toPerformanceMap(rows: Array<Record<string, unknown>>): Map<string, StrategyPerformanceSnapshot> {
  return new Map(
    rows.map((row) => [
      String(row.entry_type),
      {
        entryType: String(row.entry_type) as StrategyPerformanceSnapshot['entryType'],
        avgProfit: Number(row.avg_profit ?? 0),
        winRate: Number(row.win_rate ?? 0),
        tradesCount: Number(row.trades_count ?? 0),
        totalProfit: Number(row.total_profit ?? 0),
        dynamicScoreThreshold: Number(row.dynamic_score_threshold ?? 70),
        capitalWeight: Number(row.capital_weight ?? 1),
        enabled: Boolean(row.enabled ?? true),
      },
    ])
  );
}

export async function POST() {
  const supabase = getSupabase();
  const todayStr = new Date().toISOString().split('T')[0];
  const results = {
    processed: 0,
    auto_buys: [] as string[],
    auto_sells: [] as string[],
    logs: [] as string[],
  };

  try {
    const [{ data: wallet }, { data: openTrades }, { data: closedTrades }, { data: strategyRows }] = await Promise.all([
      supabase.from('wallet').select('balance').eq('id', 1).single(),
      supabase.from('trades').select('*').eq('status', 'OPEN'),
      supabase.from('trades').select('*').eq('status', 'CLOSED').order('closed_at', { ascending: false }).limit(50),
      supabase.from('strategy_performance').select('*'),
    ]);

    const openTradeRows = (openTrades ?? []) as TradeRow[];
    let currentBalance = Number(wallet?.balance ?? 0);
    const performanceMap = toPerformanceMap(strategyRows ?? []);
    const recentClosed = (closedTrades ?? []) as TradeRow[];
    const recentWinRate =
      recentClosed.length === 0
        ? 50
        : (recentClosed.slice(0, 10).filter((trade) => Number(trade.profit_loss ?? 0) > 0).length /
            Math.min(10, recentClosed.length)) *
          100;
    const drawdownCurve = buildLiveEquityCurve(recentClosed, 50000);
    const liveDrawdown = calculateMaxDrawdownPct(drawdownCurve);
    const riskTier = resolveRiskTier(recentWinRate, liveDrawdown);

    let marketBullish = true;
    try {
      const niftySeries = await fetchHistoricalSeries('^NSEI', { range: '1y' });
      const niftyAnalysis = analyzeStock(
        niftySeries.candles.map((candle) => candle.close),
        niftySeries.candles.map((candle) => candle.high),
        niftySeries.candles.map((candle) => candle.low),
        niftySeries.candles.map((candle) => candle.volume)
      );
      marketBullish = niftyAnalysis.trend === 'UPTREND' && niftyAnalysis.rsi >= 50;
    } catch {
      results.logs.push('NIFTY trend check failed, defaulting market filter to permissive mode');
    }

    for (const stockInfo of PRIORITY_STOCKS) {
      try {
        const series = await fetchHistoricalSeries(stockInfo.symbol, { range: '1y' });
        const candles = series.candles;
        if (candles.length < 30) {
          results.logs.push(`${stockInfo.symbol}: insufficient history`);
          continue;
        }

        const analysis = analyzeStock(
          candles.map((candle) => candle.close),
          candles.map((candle) => candle.high),
          candles.map((candle) => candle.low),
          candles.map((candle) => candle.volume)
        );
        const latestCandle = candles[candles.length - 1];
        const context = deriveStrategyContext(analysis, performanceMap);
        const capitalInUse = openTradeRows.reduce(
          (sum, trade) => sum + Number(trade.buy_price) * Number(trade.quantity),
          0
        );
        const totalEquity = currentBalance + capitalInUse;
        const capitalUsagePct = totalEquity === 0 ? 0 : capitalInUse / totalEquity;

        await supabase.from('signals').upsert(
          {
            symbol: stockInfo.symbol,
            short_name: series.shortName,
            decision: analysis.decision,
            score: analysis.score,
            confidence: analysis.confidence,
            price: latestCandle.close,
            stop_loss: analysis.stopLoss,
            target: analysis.target,
            rsi: analysis.rsi,
            reason: analysis.reason,
            trend: analysis.trend,
            change_pct: analysis.changePercent,
            run_date: todayStr,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'symbol,run_date' }
        );

        const existingTrade = openTradeRows.find((trade) => trade.symbol === stockInfo.symbol);

        if (existingTrade) {
          const hardStop = Number(existingTrade.initial_stop_loss ?? existingTrade.stop_loss ?? analysis.stopLoss);
          const newTrailingStop = Number((latestCandle.close - analysis.atr * ATR_TRAIL_MULTIPLIER).toFixed(2));
          const nextStop = Math.max(Number(existingTrade.stop_loss ?? hardStop), newTrailingStop);

          if (nextStop > Number(existingTrade.stop_loss ?? 0)) {
            await supabase
              .from('trades')
              .update({
                stop_loss: nextStop,
                highest_price: Math.max(Number(existingTrade.highest_price ?? existingTrade.buy_price), latestCandle.close),
              })
              .eq('id', existingTrade.id);
            existingTrade.stop_loss = nextStop;
          }

          if (existingTrade.target && latestCandle.high >= Number(existingTrade.target) && existingTrade.quantity > 1) {
            const partialQty = Math.max(1, Math.floor(existingTrade.quantity * 0.5));
            const partialResult = await executeAutoSell(existingTrade, Number(existingTrade.target), 'Partial Profit Booking', {
              quantity: partialQty,
              partial: true,
            });

            if (partialResult.success) {
              existingTrade.quantity -= partialQty;
              existingTrade.partial_exit_count = (existingTrade.partial_exit_count ?? 0) + 1;
              existingTrade.target = null;
              currentBalance += Number(partialResult.proceeds ?? 0);
              results.logs.push(`${existingTrade.symbol}: partial booked`);
            }
          }

          let sellReason = '';

          if (latestCandle.low <= hardStop) {
            sellReason = 'Hard stop loss';
          } else if (latestCandle.low <= Number(existingTrade.stop_loss ?? hardStop)) {
            sellReason = 'ATR trailing stop';
          } else if (analysis.rsi < 45) {
            sellReason = 'Momentum exit';
          } else if (existingTrade.market_condition === 'BULLISH' && analysis.trend !== 'UPTREND') {
            sellReason = 'Trend weakness exit';
          } else if (analysis.volumeRatio < 1) {
            sellReason = 'Volume drop exit';
          }

          if (sellReason) {
            const sellResult = await executeAutoSell(existingTrade, latestCandle.close, sellReason);
            if (sellResult.success) {
              results.auto_sells.push(stockInfo.symbol);
              const removeIndex = openTradeRows.findIndex((trade) => trade.id === existingTrade.id);
              if (removeIndex >= 0) {
                openTradeRows.splice(removeIndex, 1);
              }
              currentBalance += Number(sellResult.proceeds ?? 0);
            }
          }
        } else {
          if (
            !marketBullish ||
            analysis.decision !== 'BUY' ||
            analysis.score < context.scoreThreshold ||
            !context.enabled ||
            context.marketCondition === 'BEARISH' ||
            context.volumeStrength === 'WEAK' ||
            openTradeRows.length >= MAX_OPEN_TRADES ||
            capitalUsagePct >= MAX_CAPITAL_USAGE
          ) {
            results.logs.push(
              `${stockInfo.symbol}: skipped (${analysis.decision}, score ${analysis.score}, threshold ${context.scoreThreshold})`
            );
            results.processed += 1;
            continue;
          }

          const sizing = calculatePositionSize({
            availableCash: currentBalance,
            currentEquity: Math.max(totalEquity, currentBalance),
            price: latestCandle.close,
            stopLoss: analysis.stopLoss,
            riskTier,
            strategyWeight: context.strategyWeight,
            capitalLimitPct: Math.max(0.1, MAX_CAPITAL_USAGE - capitalUsagePct),
          });

          if (sizing.quantity <= 0) {
            results.logs.push(`${stockInfo.symbol}: sizing rejected`);
            results.processed += 1;
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
              entryScore: analysis.score,
            }
          );

          if (buyResult.success) {
            currentBalance -= Number(buyResult.cost ?? 0);
            openTradeRows.push({
              id: crypto.randomUUID(),
              symbol: stockInfo.symbol,
              short_name: series.shortName,
              buy_price: latestCandle.close,
              sell_price: null,
              quantity: sizing.quantity,
              charges: 0,
              stop_loss: analysis.stopLoss,
              target: analysis.target,
              status: 'OPEN',
              executed_by: 'AUTO',
              reason: analysis.reason,
              strategy_version: null,
              sector: stockInfo.sector,
              entry_type: context.entryType,
              market_condition: context.marketCondition,
              volume_strength: context.volumeStrength,
              risk_reward: analysis.riskReward,
              strategy_weight: context.strategyWeight,
              risk_tier: riskTier,
              partial_exit_count: 0,
              initial_stop_loss: analysis.stopLoss,
              highest_price: latestCandle.close,
              entry_score: analysis.score,
              profit_loss: 0,
              opened_at: new Date().toISOString(),
              closed_at: null,
            });
            results.auto_buys.push(stockInfo.symbol);
          }
        }

        results.processed += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.logs.push(`${stockInfo.symbol}: ${message}`);
      }
    }

    return Response.json(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Strategy execution failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
