import type {
  PositionSizingInput,
  PositionSizingResult,
  RiskTier,
} from "@/lib/trading/types";

// ================================
// ⚙️ BASE RISK CONFIG
// ================================
const BASE_RISK_PCT: Record<RiskTier, number> = {
  CONSERVATIVE: 0.005,   // 0.5%
  NORMAL: 0.01,          // 1%
  AGGRESSIVE: 0.015,     // 1.5%
};

// ================================
// 📉 DRAWdown PROTECTION
// ================================
function adjustForDrawdown(equity: number, peakEquity: number): number {
  if (!peakEquity || peakEquity <= 0) return 1;

  const drawdown = (peakEquity - equity) / peakEquity;

  if (drawdown > 0.2) return 0.4;   // heavy loss → reduce risk hard
  if (drawdown > 0.1) return 0.6;
  if (drawdown > 0.05) return 0.8;

  return 1;
}

function adjustForVolatility(riskPerShare: number, price: number): number {
  const volatility = riskPerShare / price;

  if (volatility > 0.08) return 0.7;   // only extreme volatility
  if (volatility > 0.06) return 0.85;
  if (volatility > 0.04) return 0.95;

  return 1;
}

// ================================
// 🚫 BAD TRADE FILTER
// ================================
function isTradeValid(riskPerShare: number, price: number): boolean {
  const riskRatio = riskPerShare / price;

  // Too tight SL → noise
  if (riskRatio < 0.003) return false;

  // Too wide SL → risky
  if (riskRatio > 0.06) return false;

  return true;
}

// ================================
// 🧠 MAIN POSITION SIZING
// ================================
export function calculatePositionSize(
  input: PositionSizingInput & {
    peakEquity?: number;
  }
): PositionSizingResult {

  const riskPerShare = Math.abs(input.price - input.stopLoss);

  if (riskPerShare <= 0 || input.price <= 0) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare: 0,
      capitalCommitted: 0,
    };
  }

  // ================================
  // 🚫 FILTER BAD TRADES
  // ================================
  if (!isTradeValid(riskPerShare, input.price)) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare,
      capitalCommitted: 0,
    };
  }

  // ================================
  // 📊 BASE RISK
  // ================================
  let riskPct = BASE_RISK_PCT[input.riskTier];

  // ================================
  // 📉 APPLY DRAWDOWN PROTECTION
  // ================================
  const ddFactor = adjustForDrawdown(
    input.currentEquity,
    input.peakEquity ?? input.currentEquity
  );

  // ================================
  // 📊 APPLY VOLATILITY CONTROL
  // ================================
  const volFactor = adjustForVolatility(riskPerShare, input.price);

  // ================================
  // 🎯 FINAL RISK %
  // ================================
  riskPct = riskPct * ddFactor * volFactor * input.strategyWeight;

  const riskAmount = input.currentEquity * riskPct;

  // ================================
  // 📐 POSITION SIZE
  // ================================
  const quantityByRisk = Math.floor(riskAmount / riskPerShare);

  const maxCapital = input.availableCash * input.capitalLimitPct;
  const quantityByCapital = Math.floor(maxCapital / input.price);

  let quantity = Math.min(quantityByRisk, quantityByCapital);

  // 🚫 REMOVE FORCED TRADES (IMPORTANT)
  if (quantity <= 0) {
    return {
      quantity: 0,
      riskAmount: 0,
      riskPerShare,
      capitalCommitted: 0,
    };
  }

  // ================================
  // 💳 FINAL SAFETY CHECK
  // ================================
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