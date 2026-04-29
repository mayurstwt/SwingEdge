// ================================
// 📊 CORE DECISION TYPES
// ================================
export type Decision = "BUY" | "SHORT" | "HOLD" | "AVOID";
export type TradeDirection = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED";

// ================================
// 📈 SIGNAL (Strategy Output)
// ================================
export interface Signal {
  symbol: string;
  shortName?: string;
  decision: Decision;
  score: number;
  confidence: number;
  price: number;
  stopLoss: number;
  target: number;
  rsi: number;
  trend: string;
  changePct: number;
  signals: string[];
  timestamp: string;
}

// ================================
// ⚠️ RISK CONFIG
// ================================
export type RiskTier = "CONSERVATIVE" | "NORMAL" | "AGGRESSIVE";

// ================================
// 🕯️ CANDLE & HISTORICAL SERIES (for market-data.ts)
// ================================
export interface Candle {
  date: string;           // ISO date string: "2026-04-24"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ================================
// 📐 POSITION SIZING
// ================================
export interface PositionSizingInput {
  price: number;
  stopLoss: number;
  currentEquity: number;
  availableCash: number;
  riskTier: RiskTier;
  strategyWeight: number;
  capitalLimitPct: number;
}

export interface PositionSizingResult {
  quantity: number;
  riskAmount: number;
  riskPerShare: number;
  capitalCommitted: number;
}