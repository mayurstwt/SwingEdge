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


export async function getMarketData(symbol: string): Promise<number[]> {
  try {
    const queryOptions = {
      period1: "2024-01-01",
      interval: "1d",
    };

    const result = await yahooFinance.historical(symbol + ".NS", queryOptions);

    if (!result || result.length === 0) return [];

    return result.map((item) => item.close).filter(Boolean);
  } catch (err) {
    console.error("Market data error:", err);
    return [];
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
