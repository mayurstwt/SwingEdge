import type {
  PositionSizingInput,
  PositionSizingResult,
  RiskTier,
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

// removed dynamic thresholds

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