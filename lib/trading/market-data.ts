import { fetchYahooChart } from '@/lib/yahoo-finance';
import type { Candle } from '@/lib/trading/types';

function normalizeCandleRows(rows: Array<Partial<Candle>>): Candle[] {
  return rows
    .filter(
      (row): row is Candle =>
        typeof row.date === 'string' &&
        typeof row.open === 'number' &&
        typeof row.high === 'number' &&
        typeof row.low === 'number' &&
        typeof row.close === 'number' &&
        typeof row.volume === 'number'
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Get full OHLCV series for strategy analysis (ATR, RSI, MACD, etc.)
 */


export async function getMarketDataFull(
  symbol: string,
  options?: { range?: string; interval?: string }
): Promise<{ closes: number[]; highs: number[]; lows: number[]; volumes: number[] }> {
  const range = options?.range ?? '1y';
  const interval = options?.interval ?? '1d';

  try {
    const result = await fetchYahooChart(symbol, range, interval, 15000, 2);

    const quote = result.indicators?.quote?.[0] ?? {};
    const timestamps: number[] = result.timestamp ?? [];

    const candles = normalizeCandleRows(
      timestamps.map((timestamp, index) => ({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: quote.open?.[index] ?? undefined,
        high: quote.high?.[index] ?? undefined,
        low: quote.low?.[index] ?? undefined,
        close: quote.close?.[index] ?? undefined,
        volume: quote.volume?.[index] ?? undefined,
      }))
    );

    return {
      closes: candles.map((c) => c.close),
      highs: candles.map((c) => c.high),
      lows: candles.map((c) => c.low),
      volumes: candles.map((c) => c.volume),
    };
  } catch (err) {
    console.error('Full market data error for', symbol, ':', err);
    return { closes: [], highs: [], lows: [], volumes: [] };
  }
}
