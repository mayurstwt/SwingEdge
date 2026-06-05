import type {
  PositionSizingInput,
  PositionSizingResult,
  RiskTier,
} from "@/lib/trading/types";

// ================================
// ⚙️ BASE RISK CONFIG
// ================================
const BASE_RISK_PCT: Record<RiskTier, number> = {
  CONSERVATIVE: 0.0075,  // 0.75%
  NORMAL:       0.0125,  // 1.25%
  AGGRESSIVE:   0.0200,  // 2.00%
};

/** Absolute ceiling: no single trade may risk more than 6% of equity. */
const MAX_SINGLE_TRADE_RISK_PCT = 0.06;

// ================================
// 🛡️ INPUT VALIDATION
// ================================
interface ValidationResult {
  valid: boolean;
  reason: string;
}

function validatePositionSizingInput(
  input: PositionSizingInput & { peakEquity?: number }
): ValidationResult {
  if (!input.price || input.price <= 0) {
    return { valid: false, reason: 'Invalid price' };
  }

  if (input.stopLoss >= input.price) {
    return {
      valid: false,
      reason: `Stop loss (${input.stopLoss}) must be strictly below entry price (${input.price})`,
    };
  }

  if (input.availableCash <= 0) {
    return { valid: false, reason: 'No available cash' };
  }

  if (input.currentEquity <= 0) {
    return { valid: false, reason: 'Invalid equity value' };
  }

  if (!BASE_RISK_PCT[input.riskTier]) {
    return { valid: false, reason: `Invalid risk tier: ${input.riskTier}` };
  }

  if (input.capitalLimitPct <= 0 || input.capitalLimitPct > 1) {
    return { valid: false, reason: `Invalid capitalLimitPct: ${input.capitalLimitPct}` };
  }

  if (input.strategyWeight <= 0) {
    return { valid: false, reason: `Invalid strategyWeight: ${input.strategyWeight}` };
  }

  return { valid: true, reason: 'Valid' };
}

// ================================
// 📉 DRAWDOWN PROTECTION
// ================================
function adjustForDrawdown(equity: number, peakEquity: number): number {
  if (!peakEquity || peakEquity <= 0) return 1;

  const drawdown = (peakEquity - equity) / peakEquity;

  if (drawdown > 0.20) return 0.40;  // heavy drawdown → cut risk hard
  if (drawdown > 0.10) return 0.60;
  if (drawdown > 0.05) return 0.80;

  return 1;
}

// ================================
// 📊 VOLATILITY ADJUSTMENT
// ================================
function adjustForVolatility(riskPerShare: number, price: number): number {
  const volatility = riskPerShare / price;

  if (volatility > 0.08) return 0.70;
  if (volatility > 0.06) return 0.85;
  if (volatility > 0.04) return 0.95;

  return 1;
}

// ================================
// 🚫 BAD TRADE FILTER
// ================================
function isTradeValid(riskPerShare: number, price: number): boolean {
  const riskRatio = riskPerShare / price;

  if (riskRatio < 0.003) return false;  // SL too tight → noise
  if (riskRatio > 0.06)  return false;  // SL too wide  → excessive risk

  return true;
}

// ================================
// 🧠 MAIN POSITION SIZING
// ================================
export function calculatePositionSize(
  input: PositionSizingInput & { peakEquity?: number }
): PositionSizingResult {

  // 1. Validate all inputs before any calculation
  const validation = validatePositionSizingInput(input);
  if (!validation.valid) {
    console.warn(`calculatePositionSize: ${validation.reason}`);
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare: 0,
      capitalCommitted: 0,
    };
  }

  const riskPerShare = Math.abs(input.price - input.stopLoss);

  // 2. Reject pathological stop-loss placements
  if (!isTradeValid(riskPerShare, input.price)) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare,
      capitalCommitted: 0,
    };
  }

  // 3. Base risk percentage for the chosen tier
  let riskPct = BASE_RISK_PCT[input.riskTier];

  // 4. Drawdown reduction
  const ddFactor  = adjustForDrawdown(input.currentEquity, input.peakEquity ?? input.currentEquity);

  // 5. Volatility reduction
  const volFactor = adjustForVolatility(riskPerShare, input.price);

  // 6. Final risk %
  riskPct = riskPct * ddFactor * volFactor * input.strategyWeight;

  let riskAmount = input.currentEquity * riskPct;

  // 7. Hard cap: single-trade risk must not exceed 6% of equity
  const maxRiskAmount = input.currentEquity * MAX_SINGLE_TRADE_RISK_PCT;
  if (riskAmount > maxRiskAmount) {
    console.warn(
      `calculatePositionSize: risk capped at ${MAX_SINGLE_TRADE_RISK_PCT * 100}% of equity ` +
      `(was ${(riskPct * 100).toFixed(2)}%)`
    );
    riskAmount = maxRiskAmount;
  }

  // 8. Sanity-check: reject if effective single-trade risk is still above cap
  const effectiveSingleTradeRisk = riskAmount / input.currentEquity;
  if (effectiveSingleTradeRisk > MAX_SINGLE_TRADE_RISK_PCT) {
    console.warn(
      `calculatePositionSize: single-trade risk (${(effectiveSingleTradeRisk * 100).toFixed(2)}%) ` +
      `exceeds ${MAX_SINGLE_TRADE_RISK_PCT * 100}% limit — skipping trade`
    );
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare,
      capitalCommitted: 0,
    };
  }

  // 9. Quantity by risk
  const quantityByRisk = Math.floor(riskAmount / riskPerShare);

  // 10. Quantity by capital limit
  const maxCapital       = input.availableCash * input.capitalLimitPct;
  const quantityByCapital = Math.floor(maxCapital / input.price);

  let quantity = Math.min(quantityByRisk, quantityByCapital);

  // 11. Reject zero-quantity trades immediately
  if (quantity <= 0) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare,
      capitalCommitted: 0,
    };
  }

  // 12. Final safety: ensure we never exceed available cash
  if (quantity * input.price > input.availableCash) {
    quantity = Math.floor(input.availableCash / input.price);
  }

  quantity = Math.max(0, quantity);

  return {
    quantity,
    riskAmount:       Number(riskAmount.toFixed(2)),
    riskPerShare:     Number(riskPerShare.toFixed(2)),
    capitalCommitted: Number((quantity * input.price).toFixed(2)),
  };
}