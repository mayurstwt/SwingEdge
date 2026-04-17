import axios from "axios";
import STOCKS_DATA from "@/data/stocks.json";
import type { Candle, HistoricalSeries } from "@/lib/trading/types";

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
        typeof row.date === "string" &&
        typeof row.open === "number" &&
        typeof row.high === "number" &&
        typeof row.low === "number" &&
        typeof row.close === "number" &&
        typeof row.volume === "number"
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function getStockMeta(symbol: string): { shortName: string; sector: string } {
  return STOCK_META.get(symbol) ?? {
    shortName: symbol,
    sector: "UNKNOWN",
  };
}

export async function fetchHistoricalSeries(
  symbol: string,
  options?: { range?: string; interval?: string }
): Promise<HistoricalSeries> {
  const range = options?.range ?? "3y";
  const interval = options?.interval ?? "1d";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&events=div,splits`;
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    timeout: 20000,
  });

  const result = response.data?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No historical data found for ${symbol}`);
  }

  const quote = result.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const candles = normalizeCandleRows(
    timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      volume: quote.volume?.[index],
    }))
  );

  const meta = getStockMeta(symbol);

  return {
    symbol,
    shortName: result.meta?.shortName ?? meta.shortName,
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
