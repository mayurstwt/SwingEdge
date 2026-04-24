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

  if (atr / price > 0.035) return "VOLATILE";

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
  // 🎯 STRONG TREND CONFIRMATION
  // ================================

  const strongUptrend = price > sma50 && sma50 > sma200;
  const strongDowntrend = price < sma50 && sma50 < sma200;

  // ================================
  // 📈 BULL LOGIC (STRICT)
  // ================================
  if (regime === "BULL" && strongUptrend) {

    if (macd.histogram > 0) {
      score += 25;
      signals.push("MACD Momentum Up");
    }

    if (rsi > 45 && rsi < 60) {
      score += 20;
      signals.push("RSI Healthy Trend");
    }

    if (price > sma50) {
      score += 15;
      signals.push("Above SMA50");
    }
  }

  // ================================
  // 📉 BEAR LOGIC (STRICT)
  // ================================
  if (regime === "BEAR" && strongDowntrend) {

    if (macd.histogram < 0) {
      score += 25;
      signals.push("MACD Momentum Down");
    }

    if (rsi < 55 && rsi > 40) {
      score += 20;
      signals.push("RSI Weak Trend");
    }

    if (price < sma50) {
      score += 15;
      signals.push("Below SMA50");
    }
  }

  // ================================
  // ⚠️ SIDEWAYS (REDUCED TRADING)
  // ================================
  if (regime === "SIDEWAYS") {
    if (rsi < 30) {
      score += 15;
      signals.push("Deep Oversold");
    }

    if (rsi > 70) {
      score += 15;
      signals.push("Deep Overbought");
    }
  }

  // ================================
  // ⚠️ VOLATILITY FILTER
  // ================================
  if (regime === "VOLATILE") {
    score -= 20;
    signals.push("High Volatility Avoid");
  }

  // ================================
  // 🚫 NO TRADE ZONE (IMPORTANT)
  // ================================
  if (score < 50) {
    return {
      score,
      decision: "AVOID",
      confidence: score,
      trend: "SIDEWAYS",
      entry: price,
      stopLoss: 0,
      target: 0,
      signals,
    };
  }

  // ================================
  // 🧠 DECISION LOGIC (STRICT)
  // ================================
  let decision: Decision = "HOLD";

  if (regime === "BULL" && strongUptrend && score >= 60) {
    decision = "BUY";
  }

  if (regime === "BEAR" && strongDowntrend && score >= 60) {
    decision = "SHORT";
  }

  // ================================
  // 💰 TRADE SETUP (BETTER RR)
  // ================================
  let entry = price;
  let stopLoss = 0;
  let target = 0;

  if (decision === "BUY") {
    stopLoss = price - 1.3 * atr;
    target = price + 2.5 * atr;
  }

  if (decision === "SHORT") {
    stopLoss = price + 1.3 * atr;
    target = price - 2.5 * atr;
  }

  return {
    score,
    decision,
    confidence: Math.min(score, 100),
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