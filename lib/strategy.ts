import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateVolumeRatio,
} from "./indicators";

export const STRATEGY_VERSION = "1.2.0 (Pro)";

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

  // --- Indicators ---
  const sma50Arr = calculateSMA(closes, 50);
  const sma200Arr = calculateSMA(closes, 200);
  const sma50 = sma50Arr[sma50Arr.length - 1];
  const sma200 = sma200Arr[sma200Arr.length - 1];

  const ema12Arr = calculateEMA(closes, 12);
  const ema26Arr = calculateEMA(closes, 26);

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr = calculateATR(highs, lows, closes, 14);
  const volumeRatio = calculateVolumeRatio(volumes, 20);

  // --- Scoring (0-100) ---
  let score = 0;
  const signals: string[] = [];

  // 1. Long-term trend: Price vs SMA200 (25 pts)
  let trendAlignment = false;
  if (sma200 !== null) {
    if (price > sma200) {
      score += 25;
      signals.push("✅ Price above 200 SMA (Uptrend)");
      trendAlignment = true;
    } else {
      signals.push("⚠️ Price below 200 SMA (Downtrend)");
    }
  }

  // 2. Medium-term trend: Price vs SMA50 (15 pts)
  if (sma50 !== null) {
    if (price > sma50) {
      score += 15;
      signals.push("✅ Price above 50 SMA");
    } else {
      signals.push("⚠️ Price below 50 SMA");
    }
  }

  // 3. Momentum: RSI zone (20 pts)
  if (rsi > 45 && rsi < 65) {
    score += 20;
    signals.push(`✅ RSI healthy (${rsi.toFixed(1)})`);
  } else if (rsi <= 35) {
    score += 10;
    signals.push(`⚠️ RSI oversold (${rsi.toFixed(1)})`);
  } else if (rsi >= 70) {
    signals.push(`❌ RSI overbought (${rsi.toFixed(1)})`);
  } else {
    score += 5;
    signals.push(`ℹ️ RSI neutral (${rsi.toFixed(1)})`);
  }

  // 4. MACD crossover (20 pts)
  if (macd.macdLine !== null && macd.signalLine !== null) {
    if (macd.macdLine > macd.signalLine && macd.macdLine > 0) {
      score += 20;
      signals.push("✅ MACD bullish crossover above zero");
    } else if (macd.macdLine > macd.signalLine) {
      score += 12;
      signals.push("✅ MACD bullish crossover");
    } else {
      signals.push("❌ MACD bearish");
    }
  }

  // 5. Bollinger Band position (10 pts)
  if (bb.upper !== null && bb.lower !== null && bb.middle !== null) {
    const bbRange = bb.upper - bb.lower;
    const pricePos = (price - bb.lower) / bbRange; 
    if (pricePos > 0.3 && pricePos < 0.7) {
      score += 10;
      signals.push("✅ Price in BB stability zone");
    }
  }

  // 6. Volume confirmation (10 pts)
  if (volumeRatio > 1.2) {
    score += 10;
    signals.push(`✅ Volume surge (${volumeRatio}x)`);
  }

  // --- Pro Strategy Filters ---
  let decision: "BUY" | "HOLD" | "AVOID";
  let reason = "";

  // 1. Volatility Filter (ATR > 4% of price is too risky)
  const volatility = (atr / price) * 100;
  const isTooVolatile = volatility > 4;

  if (isTooVolatile) {
    decision = "AVOID";
    reason = `Volatility too high (${volatility.toFixed(1)}%). Risk exceeds safe parameters.`;
  } else if (score >= 65) {
    // 2. Trend Alignment Rule (Must be above 200 SMA to BUY)
    if (trendAlignment) {
      decision = "BUY";
      reason = signals.filter(s => s.startsWith("✅")).slice(0, 3).join(", ");
    } else {
      decision = "HOLD";
      reason = "Bullish momentum detected but price is below 200 SMA (Catching falling knife risk).";
    }
  } else if (score >= 35) {
    decision = "HOLD";
    reason = "Neutral trend with mixed indicators.";
  } else {
    decision = "AVOID";
    reason = "Strong bearish pressure. RSI/MACD confirm negative trend.";
  }

  // --- Risk Management ---
  const stopLoss = parseFloat((price - 1.5 * atr).toFixed(2));
  const target = parseFloat((price + 2.5 * atr).toFixed(2));
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
    confidence: Math.min(score, 100),
    price: parseFloat(price.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePercent: parseFloat(changePercent.toFixed(2)),
    rsi,
    macd,
    sma50: sma50 !== null ? parseFloat(sma50.toFixed(2)) : null,
    sma200: sma200 !== null ? parseFloat(sma200.toFixed(2)) : null,
    bollingerBands: bb,
    entryZone,
    stopLoss,
    target,
    riskReward,
    volumeRatio,
    trend: price > (sma50 || 0) && (sma50 || 0) > (sma200 || 0) ? "UPTREND" : (price < (sma50 || 0) ? "DOWNTREND" : "SIDEWAYS"),
    signals,
    reason,
    priceHistory: closes.slice(-historySlice).map((v) => parseFloat(v.toFixed(2))),
    sma50History: sma50Arr.slice(-historySlice),
    sma200History: sma200Arr.slice(-historySlice),
  };
}
