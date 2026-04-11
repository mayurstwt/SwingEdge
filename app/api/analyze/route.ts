import axios from "axios";
import { analyzeStock } from "@/lib/strategy";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return Response.json({ error: "Symbol is required" }, { status: 400 });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&events=div,splits`;

    const res = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      timeout: 15000,
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) {
      return Response.json({ error: "No data returned for this symbol" }, { status: 404 });
    }

    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};

    const rawClose: (number | null)[] = quote.close ?? [];
    const rawHigh: (number | null)[] = quote.high ?? [];
    const rawLow: (number | null)[] = quote.low ?? [];
    const rawVolume: (number | null)[] = quote.volume ?? [];

    // Filter to only complete rows (no nulls)
    const rows = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: rawClose[i],
        high: rawHigh[i],
        low: rawLow[i],
        volume: rawVolume[i],
      }))
      .filter(
        (r) =>
          r.close !== null &&
          r.high !== null &&
          r.low !== null &&
          r.volume !== null
      ) as { date: string; close: number; high: number; low: number; volume: number }[];

    if (rows.length < 30) {
      return Response.json(
        { error: "Not enough historical data (need at least 30 trading days)" },
        { status: 422 }
      );
    }

    const closes = rows.map((r) => r.close);
    const highs = rows.map((r) => r.high);
    const lows = rows.map((r) => r.low);
    const volumes = rows.map((r) => r.volume);

    const meta = result.meta ?? {};
    const analysis = analyzeStock(closes, highs, lows, volumes);

    return Response.json({
      symbol: meta.symbol ?? symbol,
      shortName: meta.shortName ?? symbol,
      currency: meta.currency ?? "INR",
      exchange: meta.exchangeName ?? "NSE",
      ...analysis,
    });
  } catch (err: unknown) {
    console.error("[analyze] Error:", err);

    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) {
        return Response.json({ error: "Stock symbol not found" }, { status: 404 });
      }
      if (err.code === "ECONNABORTED") {
        return Response.json({ error: "Request timed out. Try again." }, { status: 504 });
      }
    }

    return Response.json({ error: "Failed to fetch stock data. Try again later." }, { status: 500 });
  }
}
