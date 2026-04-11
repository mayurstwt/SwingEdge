import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateVolumeRatio,
} from "./indicators";

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

  const sma20Arr = calculateSMA(closes, 20);
  const sma20 = sma20Arr[sma20Arr.length - 1];

  const ema12Arr = calculateEMA(closes, 12);
  const ema26Arr = calculateEMA(closes, 26);
  const ema12 = ema12Arr[ema12Arr.length - 1];
  const ema26 = ema26Arr[ema26Arr.length - 1];

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr = calculateATR(highs, lows, closes, 14);
  const volumeRatio = calculateVolumeRatio(volumes, 20);

  // --- Scoring (0-100) ---
  let score = 0;
  const signals: string[] = [];

  // 1. Long-term trend: Price vs SMA200 (25 pts)
  if (sma200 !== null) {
    if (price > sma200) {
      score += 25;
      signals.push("✅ Price above 200 SMA (Uptrend)");
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
    signals.push(`✅ RSI healthy (${rsi.toFixed(1)}) — momentum zone`);
  } else if (rsi <= 35) {
    score += 10; // Oversold — contrarian opportunity
    signals.push(`⚠️ RSI oversold (${rsi.toFixed(1)}) — potential reversal`);
  } else if (rsi >= 70) {
    signals.push(`❌ RSI overbought (${rsi.toFixed(1)}) — caution`);
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
      signals.push("✅ MACD bullish crossover (below zero)");
    } else if (macd.histogram !== null && macd.histogram > 0) {
      score += 5;
      signals.push("ℹ️ MACD histogram positive");
    } else {
      signals.push("❌ MACD bearish");
    }
  }

  // 5. Bollinger Band position (10 pts)
  if (bb.upper !== null && bb.lower !== null && bb.middle !== null) {
    const bbRange = bb.upper - bb.lower;
    const pricePos = (price - bb.lower) / bbRange; // 0=lower, 1=upper
    if (pricePos > 0.3 && pricePos < 0.7) {
      score += 10;
      signals.push("✅ Price in Bollinger mid-zone (stable)");
    } else if (pricePos <= 0.3) {
      score += 7;
      signals.push("ℹ️ Price near lower Bollinger Band (potential bounce)");
    } else {
      signals.push("⚠️ Price near upper Bollinger Band (stretched)");
    }
  }

  // 6. Volume confirmation (10 pts)
  if (volumeRatio > 1.2) {
    score += 10;
    signals.push(`✅ Volume ${volumeRatio}x above average (confirmation)`);
  } else if (volumeRatio > 0.8) {
    score += 5;
    signals.push(`ℹ️ Volume normal (${volumeRatio}x average)`);
  } else {
    signals.push(`⚠️ Volume below average (${volumeRatio}x) — weak move`);
  }

  // --- Decision ---
  let decision: "BUY" | "HOLD" | "AVOID";
  if (score >= 65) decision = "BUY";
  else if (score >= 35) decision = "HOLD";
  else decision = "AVOID";

  const confidence = Math.min(score, 100);

  // --- Trend ---
  let trend: "UPTREND" | "DOWNTREND" | "SIDEWAYS";
  if (sma50 !== null && sma200 !== null) {
    if (price > sma50 && sma50 > sma200) trend = "UPTREND";
    else if (price < sma50 && sma50 < sma200) trend = "DOWNTREND";
    else trend = "SIDEWAYS";
  } else {
    trend = "SIDEWAYS";
  }

  // --- Risk Management ---
  const stopLoss = parseFloat((price - 1.5 * atr).toFixed(2));
  const target = parseFloat((price + 2.5 * atr).toFixed(2));
  const risk = price - stopLoss;
  const reward = target - price;
  const riskReward = parseFloat((reward / risk).toFixed(2));

  // Entry zone: slightly below current price for better entry
  const entryZone = {
    low: parseFloat((price - 0.5 * atr).toFixed(2)),
    high: parseFloat((price + 0.3 * atr).toFixed(2)),
  };

  // Limit price history to last 90 data points for chart
  const historySlice = Math.min(closes.length, 90);

  return {
    decision,
    score: Math.round(score),
    confidence,
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
    trend,
    signals,
    priceHistory: closes.slice(-historySlice).map((v) => parseFloat(v.toFixed(2))),
    sma50History: sma50Arr.slice(-historySlice),
    sma200History: sma200Arr.slice(-historySlice),
  };
}
