import { calculateRSI, calculateSMA, calculateMACD, calculateATR } from "./indicators";

export type Decision = "BUY" | "SHORT" | "HOLD" | "AVOID";

export type MarketRegime = "BULL" | "BEAR" | "SIDEWAYS" | "VOLATILE";

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
// 🧠 MARKET REGIME DETECTION
// ================================
export function detectMarketRegime(prices: number[]): MarketRegime {
  const sma200 = calculateSMA(prices, 200);
  const rsi = calculateRSI(prices, 14);
  const atr = calculateATR(prices, 14);

  const price = prices[prices.length - 1];

  if (atr / price > 0.03) return "VOLATILE";

  if (price > sma200 && rsi > 55) return "BULL";
  if (price < sma200 && rsi < 45) return "BEAR";

  return "SIDEWAYS";
}

// ================================
// 🧠 MAIN STRATEGY
// ================================
export function analyzeStock(prices: number[]): AnalysisResult {
  const signals: string[] = [];

  const rsi = calculateRSI(prices, 14);
  const sma50 = calculateSMA(prices, 50);
  const sma200 = calculateSMA(prices, 200);
  const macd = calculateMACD(prices);
  const atr = calculateATR(prices, 14);

  const price = prices[prices.length - 1];

  const regime = detectMarketRegime(prices);

  let score = 0;

  // ================================
  // 🎯 DYNAMIC SCORING BASED ON REGIME
  // ================================

  if (regime === "BULL") {
    if (price > sma200) {
      score += 25;
      signals.push("Above SMA200 (Bullish)");
    }

    if (rsi < 60 && rsi > 40) {
      score += 15;
      signals.push("Healthy RSI");
    }

    if (macd.histogram > 0) {
      score += 15;
      signals.push("MACD Bullish");
    }
  }

  if (regime === "BEAR") {
    if (price < sma200) {
      score += 25;
      signals.push("Below SMA200 (Bearish)");
    }

    if (rsi < 50) {
      score += 15;
      signals.push("Weak RSI");
    }

    if (macd.histogram < 0) {
      score += 15;
      signals.push("MACD Bearish");
    }
  }

  if (regime === "SIDEWAYS") {
    if (rsi < 35) {
      score += 20;
      signals.push("Oversold (Mean Reversion Buy)");
    }

    if (rsi > 65) {
      score += 20;
      signals.push("Overbought (Mean Reversion Short)");
    }
  }

  if (regime === "VOLATILE") {
    score -= 10;
    signals.push("High Volatility - Risky");
  }

  // ================================
  // 🧠 DECISION LOGIC
  // ================================

  let decision: Decision = "AVOID";

  if (regime === "BULL" && score >= 60) {
    decision = "BUY";
  }

  if (regime === "BEAR" && score >= 60) {
    decision = "SHORT";
  }

  if (regime === "SIDEWAYS") {
    if (rsi < 35) decision = "BUY";
    if (rsi > 65) decision = "SHORT";
  }

  if (score >= 50 && decision === "AVOID") {
    decision = "HOLD";
  }

  // ================================
  // 💰 TRADE SETUP
  // ================================

  let entry = price;
  let stopLoss = 0;
  let target = 0;

  if (decision === "BUY") {
    stopLoss = price - 1.5 * atr;
    target = price + 2.2 * atr;
  }

  if (decision === "SHORT") {
    stopLoss = price + 1.5 * atr;
    target = price - 2.2 * atr;
  }

  const confidence = Math.min(score, 100);

  return {
    score,
    decision,
    confidence,
    trend:
      regime === "BULL"
        ? "UPTREND"
        : regime === "BEAR"
        ? "DOWNTREND"
        : "SIDEWAYS",
    entry,
    stopLoss,
    target,
    signals,
  };
}