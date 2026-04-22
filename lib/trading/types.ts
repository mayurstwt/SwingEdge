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
