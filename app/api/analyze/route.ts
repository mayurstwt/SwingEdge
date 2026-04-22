import { analyzeStock } from '@/lib/strategy';
import { fetchYahooChart } from '@/lib/yahoo-finance';
import { fetchHistoricalSeries } from '@/lib/trading/market-data';
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return Response.json({ error: 'Symbol is required' }, { status: 400 });
  }

  try {
    const result = await fetchYahooChart(symbol, '1y', '1d', 12000, 2);

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
        { error: 'Not enough historical data (need at least 30 trading days)' },
        { status: 422 }
      );
    }

    const closes = rows.map((r) => r.close);
    const highs = rows.map((r) => r.high);
    const lows = rows.map((r) => r.low);
    const volumes = rows.map((r) => r.volume);

    const meta = result.meta ?? {};
    const analysis = analyzeStock(closes, highs, lows, volumes);

    // Apply market filter to match run-strategy logic
    let marketBullish = true;
    try {
      const niftySeries = await fetchHistoricalSeries('^NSEI', { range: '1y' });
      const niftyAnalysis = analyzeStock(
        niftySeries.candles.map((c) => c.close),
        niftySeries.candles.map((c) => c.high),
        niftySeries.candles.map((c) => c.low),
        niftySeries.candles.map((c) => c.volume)
      );
      marketBullish = niftyAnalysis.trend === 'UPTREND';
    } catch {
      // ignore
    }

    if (!marketBullish) {
      analysis.score = Math.max(0, analysis.score - 10);
      analysis.reason += ' [raw score −10 (bear mkt)]';
      // Re-evaluate decision
      if (analysis.score >= 70) {
        analysis.decision = 'BUY';
      } else if (analysis.score >= 50) {
        analysis.decision = 'HOLD';
      } else {
        analysis.decision = 'AVOID';
      }
    }

    return Response.json({
      symbol: meta.symbol ?? symbol,
      shortName: meta.shortName ?? symbol,
      currency: meta.currency ?? 'INR',
      exchange: meta.exchangeName ?? 'NSE',
      ...analysis,
    });
  } catch (err: unknown) {
    console.error('[analyze] Error:', err);

    const message = err instanceof Error ? err.message : 'Failed to fetch stock data';

    if (message.includes('No chart data') || message.includes('HTTP 404')) {
      return Response.json({ error: 'Stock symbol not found' }, { status: 404 });
    }

    if (err instanceof Error && err.name === 'AbortError') {
      return Response.json({ error: 'Yahoo Finance timed out — please try again.' }, { status: 504 });
    }

    return Response.json(
      { error: `${message}. Try again in a moment.` },
      { status: 500 }
    );
  }
}
