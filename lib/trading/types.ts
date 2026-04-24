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
// 💰 TRADE MODEL (Execution Layer)
// ================================

export interface Trade {
  id?: string;

  symbol: string;

  direction: TradeDirection; // 🔥 NEW (LONG / SHORT)

  entryPrice: number;
  exitPrice?: number;

  quantity: number;

  stopLoss: number;
  target: number;

  status: TradeStatus;

  pnl?: number;

  createdAt?: string;
  closedAt?: string;
}

// ================================
// 💳 WALLET MODEL
// ================================

export interface Wallet {
  balance: number;
  usedMargin: number;
  availableBalance: number;
  updatedAt?: string;
}

// ================================
// ⚠️ RISK CONFIG
// ================================

export type RiskTier = "CONSERVATIVE" | "NORMAL" | "AGGRESSIVE";

export interface RiskConfig {
  riskPerTrade: number; // %
  maxCapitalUsage: number; // %
  maxOpenTrades: number;
}

// ================================
// 📊 ANALYSIS RESULT (Strategy Output)
// ================================

export interface AnalysisResult {
  score: number;
  decision: Decision;
  confidence: number;
  trend: string;
  entry: number;
  stopLoss: number;
  target: number;
  signals: string[];
}

// ================================
// 📉 MARKET REGIME
// ================================

export type MarketRegime = "BULL" | "BEAR" | "SIDEWAYS" | "VOLATILE";