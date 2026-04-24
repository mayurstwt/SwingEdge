import STOCKS_DATA from '@/data/stocks.json';
import { fetchYahooChart } from '@/lib/yahoo-finance';
import type { Candle, HistoricalSeries } from '@/lib/trading/types';

const STOCK_META = new Map(
  STOCKS_DATA.map((stock) => [
    stock.symbol,
    {
      shortName: stock.name,
      sector: stock.sector,
    },
  ])
);

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

export function getStockMeta(symbol: string): { shortName: string; sector: string } {
  return STOCK_META.get(symbol) ?? {
    shortName: symbol,
    sector: 'UNKNOWN',
  };
}

/**
 * Get closing prices for strategy analysis
 * Uses fetchYahooChart (your working utility) instead of non-existent yahooFinance
 */
export async function getMarketData(symbol: string): Promise<number[]> {
  try {
    const result = await fetchYahooChart(symbol, '1y', '1d', 12000, 2);

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

    return candles.map((c) => c.close);
  } catch (err) {
    console.error('Market data error for', symbol, ':', err);
    return [];
  }
}

/**
 * Get full OHLCV series for advanced analysis (ATR, etc.)
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

export async function fetchHistoricalSeries(
  symbol: string,
  options?: { range?: string; interval?: string }
): Promise<HistoricalSeries> {
  const range = options?.range ?? '3y';
  const interval = options?.interval ?? '1d';

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

  const meta = getStockMeta(symbol);

  return {
    symbol,
    shortName: (result.meta?.shortName as string) ?? meta.shortName,
    sector: meta.sector,
    candles,
  };
}

export function sanitizeHistoricalSeries(series: HistoricalSeries[]): HistoricalSeries[] {
  return series
    .map((item) => ({
      ...item,
      shortName: item.shortName || getStockMeta(item.symbol).shortName,
      sector: item.sector || getStockMeta(item.symbol).sector,
      candles: normalizeCandleRows(item.candles),
    }))
    .filter((item) => item.candles.length >= 30);
}