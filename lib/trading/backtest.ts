import { analyzeStock } from "@/lib/strategy";
import { calculateCharges } from "@/lib/wallet";
import { calculatePositionSize, resolveRiskTier } from "@/lib/trading/risk";
import {
  averageRiskReward,
  calculateDrawdownCurve,
  calculateMaxDrawdownPct,
  summarizeStrategyPerformance,
} from "@/lib/trading/performance";
import type {
  AnalysisEnvelope,
  BacktestRunResult,
  BacktestSettings,
  Candle,
  EquityPoint,
  HistoricalSeries,
  OpenPosition,
  SimulatedTrade,
  StrategyPerformanceSnapshot,
  StrategyContext,
} from "@/lib/trading/types";

const DEFAULT_SETTINGS: BacktestSettings = {
  initialCapital: 50000,
  maxOpenTrades: 5,
  maxCapitalUsage: 0.7,
  partialProfitFraction: 0.5,
  atrTrailMultiplier: 1.8,
};

export function deriveStrategyContext(
  analysis: AnalysisEnvelope["analysis"],
  performanceMap: Map<string, StrategyPerformanceSnapshot>
): StrategyContext {
  const entryType =
    analysis.volumeRatio > 1.4 && analysis.score >= 75
      ? "BREAKOUT"
      : analysis.trend === "UPTREND" && analysis.rsi <= 58
        ? "PULLBACK"
        : "MOMENTUM";

  const perf = performanceMap.get(entryType);
  const scoreThreshold = perf?.dynamicScoreThreshold ?? 70;
  const strategyWeight = perf?.capitalWeight ?? 1;
  const enabled = perf?.enabled ?? true;
  const marketCondition =
    analysis.trend === "UPTREND" && analysis.rsi >= 50
      ? "BULLISH"
      : analysis.trend === "DOWNTREND"
        ? "BEARISH"
        : "NEUTRAL";
  const volumeStrength = analysis.volumeRatio > 1.2 ? "HIGH" : analysis.volumeRatio < 1 ? "WEAK" : "NORMAL";

  return {
    entryType,
    marketCondition,
    volumeStrength,
    scoreThreshold,
    strategyWeight,
    enabled,
  };
}

function buildAnalysisEnvelope(
  candles: Candle[],
  performanceMap: Map<string, StrategyPerformanceSnapshot>
): AnalysisEnvelope {
  const analysis = analyzeStock(
    candles.map((candle) => candle.close),
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    candles.map((candle) => candle.volume)
  );

  return {
    analysis,
    context: deriveStrategyContext(analysis, performanceMap),
  };
}

function closePosition(
  position: OpenPosition,
  exitDate: string,
  exitPrice: number,
  exitReason: string
): SimulatedTrade {
  const sellValue = exitPrice * position.quantity;
  const buyValue = position.entryPrice * position.quantity;
  const sellCharges = calculateCharges(sellValue, "sell");
  const grossPnl = sellValue - buyValue;
  const netPnl = grossPnl - sellCharges;
  const barsHeld = Math.max(
    1,
    Math.round((new Date(exitDate).getTime() - new Date(position.entryDate).getTime()) / (1000 * 60 * 60 * 24))
  );

  return {
    symbol: position.symbol,
    shortName: position.shortName,
    sector: position.sector,
    entryDate: position.entryDate,
    exitDate,
    entryPrice: Number(position.entryPrice.toFixed(2)),
    exitPrice: Number(exitPrice.toFixed(2)),
    quantity: position.quantity,
    grossPnl: Number((grossPnl + position.realizedPnl).toFixed(2)),
    netPnl: Number((netPnl + position.realizedPnl).toFixed(2)),
    exitReason,
    entryType: position.entryType,
    riskReward: position.riskReward,
    partialExitCount: position.partialExitCount,
    barsHeld,
    strategyScore: position.entryScore,
    riskTier: position.riskTier,
  };
}

function computePortfolioEquity(cash: number, positions: OpenPosition[], prices: Map<string, number>): number {
  const markToMarket = positions.reduce((sum, position) => {
    const price = prices.get(position.symbol) ?? position.entryPrice;
    return sum + price * position.quantity;
  }, 0);

  return Number((cash + markToMarket).toFixed(2));
}

export function runBacktest(
  series: HistoricalSeries[],
  strategyPerformance: StrategyPerformanceSnapshot[] = [],
  settings?: Partial<BacktestSettings>
): BacktestRunResult {
  const mergedSettings: BacktestSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    initialCapital: settings?.initialCapital ?? DEFAULT_SETTINGS.initialCapital,
  };
  const performanceMap = new Map(strategyPerformance.map((item) => [item.entryType, item]));
  const startTime = new Date().toISOString();
  const positions = new Map<string, OpenPosition>();
  const tradeLog: SimulatedTrade[] = [];
  const pendingEntries = new Map<string, OpenPosition>();
  const pendingExits = new Map<string, string>();
  const dates = Array.from(
    new Set(series.flatMap((item) => item.candles.map((candle) => candle.date)))
  ).sort();
  let cash = mergedSettings.initialCapital;
  let peakEquity = mergedSettings.initialCapital;
  let recentWinRate = 50;
  let runningDrawdown = 0;
  const equityCurve: EquityPoint[] = [];
  let strategyBreakdown = strategyPerformance;

  for (const date of dates) {
    const todaysPrices = new Map<string, number>();

    for (const item of series) {
      const candleIndex = item.candles.findIndex((candle) => candle.date === date);
      if (candleIndex === -1) {
        continue;
      }

      const candle = item.candles[candleIndex];
      todaysPrices.set(item.symbol, candle.close);

      const pendingExitReason = pendingExits.get(item.symbol);
      if (pendingExitReason) {
        const position = positions.get(item.symbol);
        if (position) {
          const trade = closePosition(position, date, candle.open, pendingExitReason);
          cash += candle.open * position.quantity - calculateCharges(candle.open * position.quantity, "sell");
          positions.delete(item.symbol);
          tradeLog.push(trade);
          strategyBreakdown = summarizeStrategyPerformance(tradeLog);
        }
        pendingExits.delete(item.symbol);
      }

      const queuedEntry = pendingEntries.get(item.symbol);
      if (queuedEntry) {
        const buyValue = candle.open * queuedEntry.quantity;
        const buyCharges = calculateCharges(buyValue, "buy");
        const totalCost = buyValue + buyCharges;

        if (cash >= totalCost) {
          cash -= totalCost;
          positions.set(item.symbol, {
            ...queuedEntry,
            entryDate: date,
            entryPrice: Number(candle.open.toFixed(2)),
            highestPrice: candle.open,
          });
        }
        pendingEntries.delete(item.symbol);
      }

      const position = positions.get(item.symbol);
      if (position) {
        position.highestPrice = Math.max(position.highestPrice, candle.high);

        const history = item.candles.slice(0, candleIndex + 1);
        if (history.length >= 30) {
          const { analysis } = buildAnalysisEnvelope(history, performanceMap);
          const atrStop = Number((candle.close - analysis.atr * mergedSettings.atrTrailMultiplier).toFixed(2));
          if (atrStop > position.stopLoss) {
            position.stopLoss = atrStop;
          }

          if (position.target !== null && candle.high >= position.target && position.quantity > 1) {
            const partialQuantity = Math.max(1, Math.floor(position.quantity * mergedSettings.partialProfitFraction));
            const partialSellValue = partialQuantity * position.target;
            const partialCharges = calculateCharges(partialSellValue, "sell");
            const partialPnl =
              partialSellValue - partialCharges - position.entryPrice * partialQuantity;
            cash += partialSellValue - partialCharges;
            position.quantity -= partialQuantity;
            position.partialExitCount += 1;
            position.realizedPnl = Number((position.realizedPnl + partialPnl).toFixed(2));
            position.target = null;
          }

          let exitReason: string | null = null;
          let exitPrice = candle.close;

          if (candle.low <= position.hardStopLoss) {
            exitReason = "Hard stop loss";
            exitPrice = position.hardStopLoss;
          } else if (candle.low <= position.stopLoss) {
            exitReason = "ATR trailing stop";
            exitPrice = position.stopLoss;
          } else if (analysis.rsi < 45) {
            pendingExits.set(item.symbol, "Momentum exit");
          } else if (position.entryTrend === "UPTREND" && analysis.trend !== "UPTREND") {
            pendingExits.set(item.symbol, "Trend weakness exit");
          } else if (analysis.volumeRatio < 1) {
            pendingExits.set(item.symbol, "Volume drop exit");
          }

          if (exitReason) {
            const trade = closePosition(position, date, exitPrice, exitReason);
            cash += exitPrice * position.quantity - calculateCharges(exitPrice * position.quantity, "sell");
            positions.delete(item.symbol);
            tradeLog.push(trade);
            strategyBreakdown = summarizeStrategyPerformance(tradeLog);
          }
        }
      }

      const history = item.candles.slice(0, candleIndex + 1);
      if (
        history.length < 30 ||
        positions.has(item.symbol) ||
        pendingEntries.has(item.symbol) ||
        positions.size >= mergedSettings.maxOpenTrades
      ) {
        continue;
      }

      const envelope = buildAnalysisEnvelope(history, new Map(strategyBreakdown.map((row) => [row.entryType, row])));
      const { analysis, context } = envelope;
      if (
        analysis.decision !== "BUY" ||
        analysis.score < context.scoreThreshold ||
        !context.enabled ||
        context.marketCondition === "BEARISH" ||
        context.volumeStrength === "WEAK"
      ) {
        continue;
      }

      const portfolioEquity = computePortfolioEquity(cash, Array.from(positions.values()), todaysPrices);
      peakEquity = Math.max(peakEquity, portfolioEquity);
      runningDrawdown = peakEquity === 0 ? 0 : ((peakEquity - portfolioEquity) / peakEquity) * 100;
      recentWinRate =
        tradeLog.length < 5
          ? 50
          : (tradeLog.slice(-10).filter((trade) => trade.netPnl > 0).length / Math.min(10, tradeLog.length)) * 100;

      const capitalInUse = Array.from(positions.values()).reduce(
        (sum, openPosition) => sum + openPosition.entryPrice * openPosition.quantity,
        0
      );
      const capitalUsage = portfolioEquity === 0 ? 0 : capitalInUse / portfolioEquity;
      if (capitalUsage >= mergedSettings.maxCapitalUsage) {
        continue;
      }

      const riskTier = resolveRiskTier(recentWinRate, runningDrawdown);
      const sizing = calculatePositionSize({
        availableCash: cash,
        currentEquity: portfolioEquity,
        price: candle.close,
        stopLoss: analysis.stopLoss,
        riskTier,
        strategyWeight: context.strategyWeight,
        capitalLimitPct: Math.max(0.1, mergedSettings.maxCapitalUsage - capitalUsage),
      });

      if (sizing.quantity <= 0) {
        continue;
      }

      pendingEntries.set(item.symbol, {
        symbol: item.symbol,
        shortName: item.shortName,
        sector: item.sector,
        quantity: sizing.quantity,
        entryPrice: candle.close,
        stopLoss: analysis.stopLoss,
        hardStopLoss: analysis.stopLoss,
        target: analysis.target,
        entryDate: date,
        entryTrend: analysis.trend,
        entryScore: analysis.score,
        riskReward: analysis.riskReward,
        entryType: context.entryType,
        strategyWeight: context.strategyWeight,
        riskTier,
        partialExitCount: 0,
        realizedPnl: 0,
        highestPrice: candle.close,
        pendingExitReason: null,
      });
    }

    const dailyEquity = computePortfolioEquity(cash, Array.from(positions.values()), todaysPrices);
    equityCurve.push({
      date,
      equity: dailyEquity,
    });
  }

  const finalPrices = new Map<string, number>();
  for (const item of series) {
    const lastCandle = item.candles[item.candles.length - 1];
    if (lastCandle) {
      finalPrices.set(item.symbol, lastCandle.close);
    }
  }

  for (const position of positions.values()) {
    const price = finalPrices.get(position.symbol) ?? position.entryPrice;
    const exitDate = dates[dates.length - 1];
    const trade = closePosition(position, exitDate, price, "End of backtest");
    tradeLog.push(trade);
    cash += price * position.quantity - calculateCharges(price * position.quantity, "sell");
  }

  const drawdownCurve = calculateDrawdownCurve(equityCurve);
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? mergedSettings.initialCapital;
  const winningTrades = tradeLog.filter((trade) => trade.netPnl > 0).length;

  return {
    startedAt: startTime,
    completedAt: new Date().toISOString(),
    initialCapital: mergedSettings.initialCapital,
    finalEquity: Number(finalEquity.toFixed(2)),
    totalReturnPct: Number((((finalEquity - mergedSettings.initialCapital) / mergedSettings.initialCapital) * 100).toFixed(2)),
    maxDrawdownPct: Number(calculateMaxDrawdownPct(equityCurve).toFixed(2)),
    winRate: tradeLog.length === 0 ? 0 : Number(((winningTrades / tradeLog.length) * 100).toFixed(2)),
    avgRiskReward: averageRiskReward(tradeLog),
    totalTrades: tradeLog.length,
    equityCurve,
    drawdownCurve,
    tradeLog,
    strategyBreakdown: summarizeStrategyPerformance(tradeLog),
    settings: mergedSettings,
  };
}
