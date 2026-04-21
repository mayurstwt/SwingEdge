import {
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateVolumeRatio,
} from "./indicators";

export const STRATEGY_VERSION = "2.0 (Adaptive Trader)";

export interface AnalysisResult {
  decision: "BUY" | "HOLD" | "AVOID";
  score: number;
  confidence: number;
  price: number;
  change: number;
  changePercent: number;
  rsi: number;
  macd: {
    macdLine: number | null;
    signalLine: number | null;
    histogram: number | null;
  };
  sma50: number | null;
  sma200: number | null;
  bollingerBands: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
  };
  entryZone: { low: number; high: number };
  stopLoss: number;
  target: number;
  riskReward: number;
  volumeRatio: number;
  trend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  signals: string[];
  reason: string;
  atr: number;
  priceHistory: number[];
  sma50History: (number | null)[];
  sma200History: (number | null)[];
}

export function analyzeStock(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[]
): AnalysisResult {
  if (closes.length < 30) {
    throw new Error("Not enough price data for analysis");
  }

  const price = closes[closes.length - 1];
  const prevPrice = closes[closes.length - 2];
  const change = price - prevPrice;
  const changePercent = (change / prevPrice) * 100;

  const sma50Arr = calculateSMA(closes, 50);
  const sma200Arr = calculateSMA(closes, 200);
  const sma50 = sma50Arr[sma50Arr.length - 1];
  const sma200 = sma200Arr[sma200Arr.length - 1];

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr = calculateATR(highs, lows, closes, 14);
  const volumeRatio = calculateVolumeRatio(volumes, 20);

  let score = 0;
  let confidence = 50;
  const signals: string[] = [];

  // 🔥 Trend scoring (no longer blocking)
  if (sma200 && price > sma200) {
    score += 20;
    confidence += 10;
    signals.push("Uptrend (SMA200)");
  } else if (sma200) {
    score += 5;
    confidence -= 5;
  }

  if (sma50 && price > sma50) {
    score += 15;
    confidence += 5;
  }

  // 🔥 RSI improved logic
  if (rsi >= 40 && rsi <= 70) {
    score += 20;
  } else if (rsi < 40) {
    score += 10; // dip buying
  } else {
    score += 5;
    confidence -= 5;
  }

  // 🔥 MACD smarter scoring
  if (macd.macdLine && macd.signalLine) {
    if (macd.macdLine > macd.signalLine) {
      score += 15;
      confidence += 5;
    } else {
      confidence -= 5;
    }
  }

  // 🔥 Volume boost
  if (volumeRatio > 1.1) {
    score += 10;
    confidence += 5;
  }

  // 🔥 Bollinger context
  if (bb.middle && price > bb.middle) {
    score += 10;
  }

  // 🔥 Volatility filter softened
  const volatility = (atr / price) * 100;
  if (volatility > 6) {
    confidence -= 10;
  }

  // 🔥 Final decision logic (flexible)
  let decision: "BUY" | "HOLD" | "AVOID";
  let reason = "";

  if (score >= 60 && confidence >= 55) {
    decision = "BUY";
    reason = "Strong setup with confirmation";
  } else if (score >= 50) {
    decision = "BUY"; // 🔥 key change (previously HOLD)
    reason = "Moderate setup (early entry)";
  } else if (score >= 35) {
    decision = "HOLD";
    reason = "Mixed signals";
  } else {
    decision = "AVOID";
    reason = "Weak setup";
  }

  const stopLoss = parseFloat((price - 1.5 * atr).toFixed(2));
  const target = parseFloat((price + 2.2 * atr).toFixed(2));
  const risk = price - stopLoss;
  const reward = target - price;
  const riskReward = parseFloat((reward / risk).toFixed(2));

  const entryZone = {
    low: parseFloat((price - 0.5 * atr).toFixed(2)),
    high: parseFloat((price + 0.3 * atr).toFixed(2)),
  };

  const historySlice = Math.min(closes.length, 90);

  return {
    decision,
    score: Math.round(score),
    confidence: Math.min(100, Math.max(0, Math.round(confidence))),
    price: parseFloat(price.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    rsi,
    macd,
    sma50: sma50 ?? null,
    sma200: sma200 ?? null,
    bollingerBands: bb,
    entryZone,
    stopLoss,
    target,
    riskReward,
    volumeRatio,
    trend:
      price > (sma50 || 0) && (sma50 || 0) > (sma200 || 0)
        ? "UPTREND"
        : price < (sma50 || 0)
        ? "DOWNTREND"
        : "SIDEWAYS",
    signals,
    reason,
    atr,
    priceHistory: closes.slice(-historySlice),
    sma50History: sma50Arr.slice(-historySlice),
    sma200History: sma200Arr.slice(-historySlice),
  };
}