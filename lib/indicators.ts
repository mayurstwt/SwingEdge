// Technical indicator calculations for swing trading analysis

/**
 * Simple Moving Average
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

/**
 * Exponential Moving Average
 */
export function calculateEMA(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(data.length).fill(null);

  // Seed with first SMA
  const firstSMAIdx = period - 1;
  if (data.length < period) return result;

  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[firstSMAIdx] = ema;

  for (let i = firstSMAIdx + 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }

  return result;
}

/**
 * Relative Strength Index (Wilder's method)
 */
export function calculateRSI(data: number[], period = 14): number {
  if (data.length < period + 1) return 50; // Not enough data, return neutral

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

  // Smooth with subsequent values
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/**
 * MACD (12, 26, 9)
 */
export function calculateMACD(data: number[]): {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
} {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);

  const macdSeries: (number | null)[] = ema12.map((v, i) => {
    if (v === null || ema26[i] === null) return null;
    return v - (ema26[i] as number);
  });

  const validMacd = macdSeries.filter((v) => v !== null) as number[];
  const signalSeries = calculateEMA(validMacd, 9);

  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  const histogram = macdLine !== null && signalLine !== null ? macdLine - signalLine : null;

  return {
    macdLine: macdLine !== null ? parseFloat(macdLine.toFixed(2)) : null,
    signalLine: signalLine !== null ? parseFloat((signalLine as number).toFixed(2)) : null,
    histogram: histogram !== null ? parseFloat(histogram.toFixed(2)) : null,
  };
}

/**
 * Bollinger Bands (20-period, 2 std dev)
 */
export function calculateBollingerBands(
  data: number[],
  period = 20,
  multiplier = 2
): { upper: number | null; middle: number | null; lower: number | null } {
  if (data.length < period) {
    return { upper: null, middle: null, lower: null };
  }

  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: parseFloat((mean + multiplier * stdDev).toFixed(2)),
    middle: parseFloat(mean.toFixed(2)),
    lower: parseFloat((mean - multiplier * stdDev).toFixed(2)),
  };
}

/**
 * Average True Range (volatility)
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  if (highs.length < period + 1) {
    // Fallback: use simple price range
    const range =
      highs.slice(-period).reduce((a, b) => a + b, 0) / period -
      lows.slice(-period).reduce((a, b) => a + b, 0) / period;
    return Math.abs(range);
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // Initial ATR
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return parseFloat(atr.toFixed(2));
}

/**
 * Volume analysis - compare recent volume to average
 */
export function calculateVolumeRatio(volumes: number[], lookback = 20): number {
  if (volumes.length < lookback + 1) return 1;
  const recentVol = volumes[volumes.length - 1];
  const avgVol =
    volumes.slice(-lookback - 1, -1).reduce((a, b) => a + b, 0) / lookback;
  return parseFloat((recentVol / avgVol).toFixed(2));
}
