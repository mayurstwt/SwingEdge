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
// 💰 TRADE MODEL (Execution Layer)
// ================================
export interface Trade {
  id?: string;
  symbol: string;
  direction: TradeDirection;
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
  riskPerTrade: number;
  maxCapitalUsage: number;
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
  price?: number;
  change?: number;
  changePercent?: number;
  rsi?: number;
  macd?: {
    macdLine: number | null;
    signalLine: number | null;
    histogram: number | null;
  };
  sma50?: number | null;
  sma200?: number | null;
  bollingerBands?: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
  entryZone?: { low: number; high: number };
  riskReward?: number;
  volumeRatio?: number;
  priceHistory?: number[];
  sma50History?: (number | null)[];
  sma200History?: (number | null)[];
}

// ================================
// 📉 MARKET REGIME
// ================================
export type MarketRegime = "BULL" | "BEAR" | "SIDEWAYS" | "VOLATILE";

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

export interface HistoricalSeries {
  symbol: string;
  shortName: string;
  sector: string;
  candles: Candle[];
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