import type {
  PositionSizingInput,
  PositionSizingResult,
  RiskTier,
  StrategyPerformanceSnapshot,
} from "@/lib/trading/types";

const RISK_PCT_BY_TIER: Record<RiskTier, number> = {
  CONSERVATIVE: 0.005,
  NORMAL: 0.01,
  AGGRESSIVE: 0.015,
};

export function getRiskPercent(riskTier: RiskTier): number {
  return RISK_PCT_BY_TIER[riskTier];
}

export function resolveRiskTier(recentWinRate: number, drawdownPct: number): RiskTier {
  if (drawdownPct >= 10 || recentWinRate < 45) {
    return "CONSERVATIVE";
  }

  if (recentWinRate >= 60 && drawdownPct <= 5) {
    return "AGGRESSIVE";
  }

  return "NORMAL";
}

export function computeDynamicScoreThreshold(
  performance?: Pick<StrategyPerformanceSnapshot, "winRate" | "avgProfit" | "tradesCount">
): number {
  if (!performance || performance.tradesCount < 5) {
    return 70;
  }

  if (performance.winRate < 40 && performance.avgProfit < 0) {
    return 78;
  }

  if (performance.winRate > 60 && performance.avgProfit > 0) {
    return 64;
  }

  if (performance.winRate > 55) {
    return 67;
  }

  return 70;
}

export function computeStrategyWeight(
  performance?: Pick<StrategyPerformanceSnapshot, "winRate" | "avgProfit" | "tradesCount">
): number {
  if (!performance || performance.tradesCount < 5) {
    return 1;
  }

  let weight = 1 + (performance.winRate - 50) / 100;

  if (performance.avgProfit < 0) {
    weight -= 0.15;
  }

  return Math.min(1.5, Math.max(0.6, Number(weight.toFixed(2))));
}

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const riskPerShare = Math.abs(input.price - input.stopLoss);

  if (riskPerShare <= 0) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare: 0,
      capitalCommitted: 0,
    };
  }

  const riskAmount = input.currentEquity * getRiskPercent(input.riskTier) * input.strategyWeight;
  const quantityByRisk = Math.floor(riskAmount / riskPerShare);
  const maxCapital = input.availableCash * input.capitalLimitPct;
  const quantityByCapital = Math.floor(maxCapital / input.price);
  const quantity = Math.max(0, Math.min(quantityByRisk, quantityByCapital));

  return {
    quantity,
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(2)),
    capitalCommitted: Number((quantity * input.price).toFixed(2)),
  };
}
