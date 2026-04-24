// lib/strategy.ts
import {
  calculateRSI,
  calculateSMA,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateVolumeRatio,
} from './indicators';

export type Decision = 'BUY' | 'HOLD' | 'AVOID';

export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';

export interface AnalysisResult {
  score: number;
  decision: Decision;
  confidence: number;
  trend: string;
  entry: number;
  stopLoss: number;
  target: number;
  signals: string[];
  // Extended fields returned by API and used by UI
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
  entryZone?: {
    low: number;
    high: number;
  };
  riskReward?: number;
  volumeRatio?: number;
  // Chart histories
  priceHistory?: number[];
  sma50History?: (number | null)[];
  sma200History?: (number | null)[];
}

// ================================
// 🧠 MARKET REGIME DETECTION
// ================================
export function detectMarketRegime(prices: number[]): MarketRegime {
  const sma200Arr = calculateSMA(prices, 200);
  const sma200 = sma200Arr[sma200Arr.length - 1];
  const rsi = calculateRSI(prices, 14);
  const price = prices[prices.length - 1];

  // Use last 14 days for ATR approximation with just closes
  const recentHighs = prices.slice(-14);
  const recentLows = prices.slice(-14);
  const atr = calculateATR(recentHighs, recentLows, recentHighs, 14);

  if (atr / price > 0.035) return 'VOLATILE';

  if (sma200 !== null && price > sma200 && rsi > 55) return 'BULL';
  if (sma200 !== null && price < sma200 && rsi < 45) return 'BEAR';

  return 'SIDEWAYS';
}

// ================================
// 🧠 MAIN STRATEGY — Static Trader v2.0
// ================================
export function analyzeStock(
  prices: number[],
  highs?: number[],
  lows?: number[],
  volumes?: number[]
): AnalysisResult {
  const signals: string[] = [];

  const rsi = calculateRSI(prices, 14);
  const sma50Arr = calculateSMA(prices, 50);
  const sma200Arr = calculateSMA(prices, 200);
  const macd = calculateMACD(prices);

  const sma50 = sma50Arr[sma50Arr.length - 1];
  const sma200 = sma200Arr[sma200Arr.length - 1];
  const price = prices[prices.length - 1];

  // ATR: use provided highs/lows or fallback to price range approximation
  let atr: number;
  if (highs && lows && highs.length === prices.length && lows.length === prices.length) {
    atr = calculateATR(highs, lows, prices, 14);
  } else {
    // Fallback: approximate ATR using close-to-close ranges
    const approxHighs = prices.map((p, i) => (i > 0 ? Math.max(p, prices[i - 1]) : p));
    const approxLows = prices.map((p, i) => (i > 0 ? Math.min(p, prices[i - 1]) : p));
    atr = calculateATR(approxHighs, approxLows, prices, 14);
  }

  const bb = calculateBollingerBands(prices, 20, 2);
  const volRatio = volumes ? calculateVolumeRatio(volumes, 20) : 1;

  // ================================
  // 📊 STATIC SCORING MODEL (per README)
  // ================================
  let score = 0;

  // 1. Trend (SMA200) = 20pts
  if (sma200 !== null) {
    if (price > sma200) {
      score += 20;
      signals.push('Price above SMA200 (Bullish trend)');
    } else {
      score += 5;
      signals.push('Price below SMA200 (Bearish trend)');
    }
  }

  // 2. RSI = 20pts
  if (rsi > 50 && rsi < 70) {
    score += 20;
    signals.push('RSI in bullish zone (50-70)');
  } else if (rsi >= 30 && rsi <= 50) {
    score += 10;
    signals.push('RSI neutral (30-50)');
  } else if (rsi < 30) {
    score += 15;
    signals.push('RSI oversold (<30) - potential bounce');
  } else if (rsi >= 70) {
    score += 5;
    signals.push('RSI overbought (>70) - caution');
  }

  // 3. MACD = 15pts
  if (macd.histogram !== null) {
    if (macd.histogram > 0) {
      score += 15;
      signals.push('MACD histogram positive');
    } else if (macd.histogram > -0.5) {
      score += 5;
      signals.push('MACD histogram slightly negative');
    } else {
      signals.push('MACD histogram negative');
    }
  }

  // 4. SMA50 vs SMA200 (Golden/Death cross)
  if (sma50 !== null && sma200 !== null) {
    if (sma50 > sma200) {
      score += 10;
      signals.push('SMA50 > SMA200 (Golden cross alignment)');
    } else {
      score -= 5;
      signals.push('SMA50 < SMA200 (Death cross alignment)');
    }
  }

  // 5. Price vs SMA50
  if (sma50 !== null) {
    if (price > sma50) {
      score += 10;
      signals.push('Price above SMA50');
    } else {
      score -= 5;
      signals.push('Price below SMA50');
    }
  }

  // 6. Volatility = -10pts if high
  const regime = detectMarketRegime(prices);
  if (regime === 'VOLATILE') {
    score -= 10;
    signals.push('High volatility detected (-10)');
  }

  // 7. Volume confirmation
  if (volRatio > 1.2) {
    score += 5;
    signals.push('Above average volume');
  }

  // Clamp score 0-100
  score = Math.max(0, Math.min(100, score));

  // ================================
  // 🎯 DECISION THRESHOLDS (per README)
  // ================================
  let decision: Decision = 'AVOID';

  if (score >= 70) {
    decision = 'BUY';
  } else if (score >= 50) {
    decision = 'HOLD';
  } else {
    decision = 'AVOID';
  }

  // ================================
  // 💰 TRADE SETUP (per README rules)
  // ================================
  const entry = price;
  const stopLoss = price - 1.5 * atr;
  const target = price + 2.2 * atr;
  const riskReward = atr > 0 ? parseFloat(((target - entry) / (entry - stopLoss)).toFixed(2)) : 0;

  // Entry zone: small buffer around current price
  const entryZone = {
    low: parseFloat((price * 0.985).toFixed(2)),
    high: parseFloat((price * 1.01).toFixed(2)),
  };

  // Trend string for UI
  const trend =
    regime === 'BULL' ? 'UPTREND' : regime === 'BEAR' ? 'DOWNTREND' : 'SIDEWAYS';

  return {
    score,
    decision,
    confidence: Math.min(score, 100),
    trend,
    entry,
    stopLoss: parseFloat(stopLoss.toFixed(2)),
    target: parseFloat(target.toFixed(2)),
    signals,
    // Extended fields
    price,
    rsi,
    macd,
    sma50,
    sma200,
    bollingerBands: bb,
    entryZone,
    riskReward,
    volumeRatio: volRatio,
    // Chart histories for PriceChart component
    priceHistory: prices.slice(-120), // Last 120 days
    sma50History: sma50Arr.slice(-120),
    sma200History: sma200Arr.slice(-120),
  };
}