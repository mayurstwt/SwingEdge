import type { AnalysisResult } from "@/lib/strategy";

export type TradeDecision = "BUY" | "HOLD" | "AVOID";
export type TrendState = "UPTREND" | "DOWNTREND" | "SIDEWAYS";
export type EntryType = "BREAKOUT" | "PULLBACK" | "MOMENTUM" | "UNKNOWN";
export type MarketCondition = "BULLISH" | "NEUTRAL" | "BEARISH";
export type VolumeStrength = "HIGH" | "NORMAL" | "WEAK";
export type RiskTier = "CONSERVATIVE" | "NORMAL" | "AGGRESSIVE";

export interface Candle {
  date: string;
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

export interface StrategyContext {
  entryType: EntryType;
  marketCondition: MarketCondition;
  volumeStrength: VolumeStrength;
  scoreThreshold: number;
  strategyWeight: number;
  enabled: boolean;
}

export interface StrategyPerformanceSnapshot {
  entryType: EntryType;
  avgProfit: number;
  winRate: number;
  tradesCount: number;
  totalProfit: number;
  dynamicScoreThreshold: number;
  capitalWeight: number;
  enabled: boolean;
}

export interface PositionSizingInput {
  availableCash: number;
  currentEquity: number;
  price: number;
  stopLoss: number;
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

export interface OpenPosition {
  symbol: string;
  shortName: string;
  sector: string;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  hardStopLoss: number;
  target: number | null;
  entryDate: string;
  entryTrend: TrendState;
  entryScore: number;
  riskReward: number | null;
  entryType: EntryType;
  strategyWeight: number;
  riskTier: RiskTier;
  partialExitCount: number;
  realizedPnl: number;
  highestPrice: number;
  pendingExitReason: string | null;
}

export interface SimulatedTrade {
  symbol: string;
  shortName: string;
  sector: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  exitReason: string;
  entryType: EntryType;
  riskReward: number | null;
  partialExitCount: number;
  barsHeld: number;
  strategyScore: number;
  riskTier: RiskTier;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface DrawdownPoint {
  date: string;
  drawdownPct: number;
}

export interface BacktestSettings {
  initialCapital: number;
  maxOpenTrades: number;
  maxCapitalUsage: number;
  partialProfitFraction: number;
  atrTrailMultiplier: number;
  symbolLimit?: number;
}

export interface BacktestRequestPayload {
  name?: string;
  symbols?: string[];
  historicalData?: HistoricalSeries[];
  initialCapital?: number;
  startDate?: string;
  endDate?: string;
  settings?: Partial<Omit<BacktestSettings, "initialCapital">>;
  forceRefresh?: boolean;
}

export interface BacktestRunResult {
  startedAt: string;
  completedAt: string;
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRate: number;
  avgRiskReward: number;
  totalTrades: number;
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  tradeLog: SimulatedTrade[];
  strategyBreakdown: StrategyPerformanceSnapshot[];
  settings: BacktestSettings;
}

export interface AnalysisEnvelope {
  analysis: AnalysisResult;
  context: StrategyContext;
}
