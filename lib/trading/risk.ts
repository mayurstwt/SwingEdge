import type {
  PositionSizingInput,
  PositionSizingResult,
  RiskTier,
  StrategyPerformanceSnapshot,
} from "@/lib/trading/types";

// 🔥 Slightly more practical risk
const RISK_PCT_BY_TIER: Record<RiskTier, number> = {
  CONSERVATIVE: 0.0075,
  NORMAL: 0.0125,
  AGGRESSIVE: 0.02,
};

export function getRiskPercent(riskTier: RiskTier): number {
  return RISK_PCT_BY_TIER[riskTier];
}

// 🔥 Less strict tier switching
export function resolveRiskTier(recentWinRate: number, drawdownPct: number): RiskTier {
  if (drawdownPct >= 12 || recentWinRate < 40) {
    return "CONSERVATIVE";
  }

  if (recentWinRate >= 58 && drawdownPct <= 6) {
    return "AGGRESSIVE";
  }

  return "NORMAL";
}

// 🔥 Relaxed threshold (more trades)
export function computeDynamicScoreThreshold(
  performance?: Pick<StrategyPerformanceSnapshot, "winRate" | "avgProfit" | "tradesCount">
): number {
  if (!performance || performance.tradesCount < 5) {
    return 65;
  }

  if (performance.winRate < 40 && performance.avgProfit < 0) {
    return 72;
  }

  if (performance.winRate > 60 && performance.avgProfit > 0) {
    return 58;
  }

  if (performance.winRate > 55) {
    return 60;
  }

  return 65;
}

// 🔥 Better weight distribution
export function computeStrategyWeight(
  performance?: Pick<StrategyPerformanceSnapshot, "winRate" | "avgProfit" | "tradesCount">
): number {
  if (!performance || performance.tradesCount < 5) {
    return 1;
  }

  let weight = 1 + (performance.winRate - 50) / 120;

  if (performance.avgProfit < 0) {
    weight -= 0.1;
  }

  return Math.min(1.6, Math.max(0.7, Number(weight.toFixed(2))));
}

// 🔥 MAIN FIX — Smart Position Sizing
export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const riskPerShare = Math.abs(input.price - input.stopLoss);

  if (riskPerShare <= 0 || input.price <= 0) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare: 0,
      capitalCommitted: 0,
    };
  }

  const riskAmount =
    input.currentEquity *
    getRiskPercent(input.riskTier) *
    input.strategyWeight;

  const quantityByRisk = Math.floor(riskAmount / riskPerShare);

  const maxCapital = input.availableCash * input.capitalLimitPct;
  const quantityByCapital = Math.floor(maxCapital / input.price);

  let quantity = Math.min(quantityByRisk, quantityByCapital);

  // 🔥 CRITICAL FIX: fallback sizing
  if (quantity <= 0 && quantityByCapital > 0) {
    quantity = Math.min(1, quantityByCapital);
  }

  // 🔥 Safety: never exceed capital
  if (quantity * input.price > input.availableCash) {
    quantity = Math.floor(input.availableCash / input.price);
  }

  quantity = Math.max(0, quantity);

  return {
    quantity,
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(2)),
    capitalCommitted: Number((quantity * input.price).toFixed(2)),
  };
}