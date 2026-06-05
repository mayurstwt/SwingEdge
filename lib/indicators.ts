// Technical indicator calculations for swing trading analysis

// ================================
// 🛡️ VALIDATION HELPERS
// ================================

/**
 * Validates that a price array is non-empty, long enough, and contains only
 * finite, positive numbers. Returns `false` (with a console.warn) on failure.
 */
function validatePriceArray(
  prices: number[] | undefined,
  minLength: number = 1,
  context: string = 'price data'
): prices is number[] {
  if (!prices || !Array.isArray(prices)) {
    console.warn(`${context}: data is not an array`);
    return false;
  }

  if (prices.length < minLength) {
    console.warn(`${context}: insufficient data (${prices.length} < ${minLength})`);
    return false;
  }

  if (!prices.every(p => typeof p === 'number' && isFinite(p) && p > 0)) {
    console.warn(`${context}: contains invalid values (NaN, Infinity, negative, or non-numbers)`);
    return false;
  }

  return true;
}

// ================================
// 📈 SIMPLE MOVING AVERAGE
// ================================

/**
 * Returns an array of SMA values (null until enough data is available).
 * Preserves the original array-output signature used by strategy.ts.
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const fallbackLen = Array.isArray(data) ? data.length : 0;
  if (!validatePriceArray(data, period, 'SMA input')) {
    return new Array(fallbackLen).fill(null);
  }

  if (period <= 0 || !Number.isInteger(period)) {
    console.warn(`SMA: invalid period ${period}`);
    return new Array(data.length).fill(null);
  }

  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

// ================================
// 📈 EXPONENTIAL MOVING AVERAGE
// ================================

/**
 * Returns an array of EMA values (null until enough data is available).
 * Preserves the original array-output signature used by strategy.ts.
 */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data?.length ?? 0).fill(null);

  if (!validatePriceArray(data, period, 'EMA input')) return result;

  const k = 2 / (period + 1);
  const firstSMAIdx = period - 1;

  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[firstSMAIdx] = ema;

  for (let i = firstSMAIdx + 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

// ================================
// 📊 RSI (Wilder's method)
// ================================

/**
 * Returns a single RSI value (0–100). Returns 50 (neutral) when there's
 * insufficient or invalid data.
 */
export function calculateRSI(data: number[], period = 14): number {
  if (!validatePriceArray(data, period + 1, 'RSI input')) return 50;

  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder's smoothing for subsequent values
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, parseFloat(rsi.toFixed(2))));
}

// ================================
// 📈 MACD (12, 26, 9)
// ================================

export function calculateMACD(data: number[]): {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
} {
  const FAST = 12;
  const SLOW = 26;
  const SIGNAL = 9;

  if (!validatePriceArray(data, SLOW + SIGNAL, 'MACD input')) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const ema12 = calculateEMA(data, FAST);
  const ema26 = calculateEMA(data, SLOW);

  const macdSeries: (number | null)[] = ema12.map((v, i) => {
    if (v === null || ema26[i] === null) return null;
    return v - (ema26[i] as number);
  });

  const validMacd = macdSeries.filter((v): v is number => v !== null);
  const signalSeries = calculateEMA(validMacd, SIGNAL);

  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  const histogram =
    macdLine !== null && signalLine !== null ? macdLine - signalLine : null;

  return {
    macdLine: macdLine !== null ? parseFloat(macdLine.toFixed(2)) : null,
    signalLine:
      signalLine !== null ? parseFloat((signalLine as number).toFixed(2)) : null,
    histogram: histogram !== null ? parseFloat(histogram.toFixed(2)) : null,
  };
}

// ================================
// 📊 BOLLINGER BANDS (20-period, 2 std dev)
// ================================

export function calculateBollingerBands(
  data: number[],
  period = 20,
  multiplier = 2
): { upper: number | null; middle: number | null; lower: number | null } {
  if (!validatePriceArray(data, period, 'Bollinger Bands input')) {
    return { upper: null, middle: null, lower: null };
  }

  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: parseFloat((mean + multiplier * stdDev).toFixed(2)),
    middle: parseFloat(mean.toFixed(2)),
    lower: parseFloat((mean - multiplier * stdDev).toFixed(2)),
  };
}

// ================================
// 📊 AVERAGE TRUE RANGE (volatility)
// ================================

/**
 * Returns a single ATR value. Falls back to a simple price-range average
 * when not enough bars are available (preserves original fallback behaviour).
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  // Validate all three arrays have matching lengths
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    highs.length !== lows.length ||
    lows.length !== closes.length
  ) {
    console.warn('ATR: mismatched array lengths or invalid input');
    return 0;
  }

  if (highs.length < period + 1) {
    // Fallback: simple price range approximation (original behaviour)
    const range =
      highs.slice(-period).reduce((a, b) => a + b, 0) / period -
      lows.slice(-period).reduce((a, b) => a + b, 0) / period;
    return Math.abs(range);
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const prevClose = closes[i - 1];

    if (!isFinite(h) || !isFinite(l) || !isFinite(prevClose)) continue;

    const tr = Math.max(
      h - l,
      Math.abs(h - prevClose),
      Math.abs(l - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return 0;

  // Initial ATR (simple average)
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return parseFloat(atr.toFixed(2));
}

// ================================
// 📊 VOLUME RATIO
// ================================

/**
 * Compares the most recent bar's volume to the rolling average.
 * Returns 1 (neutral) when there's not enough data.
 */
export function calculateVolumeRatio(volumes: number[], lookback = 20): number {
  if (!validatePriceArray(volumes, lookback + 1, 'Volume ratio input')) return 1;

  const recentVol = volumes[volumes.length - 1];
  const avgVol =
    volumes.slice(-lookback - 1, -1).reduce((a, b) => a + b, 0) / lookback;

  if (avgVol === 0) return 1;

  return parseFloat((recentVol / avgVol).toFixed(2));
}
