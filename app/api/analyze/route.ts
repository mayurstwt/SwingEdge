import { analyzeStock } from '@/lib/strategy';
import { fetchYahooChart } from '@/lib/yahoo-finance';
import { fetchHistoricalSeries, getMarketDataFull } from '@/lib/trading/market-data';
import type { AnalysisResult } from '@/lib/strategy';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return Response.json({ error: 'Symbol is required' }, { status: 400 });
  }

  try {
    // Fetch full OHLCV data for the requested stock
    const { closes, highs, lows, volumes } = await getMarketDataFull(symbol, {
      range: '1y',
      interval: '1d',
    });

    if (closes.length < 30) {
      return Response.json(
        { error: 'Not enough historical data (need at least 30 trading days)' },
        { status: 422 }
      );
    }

    // Run analysis with full data (OHLCV)
    const analysis = analyzeStock(closes, highs, lows, volumes);

    // Fetch metadata from Yahoo Finance
    const result = await fetchYahooChart(symbol, '1d', '1d', 8000, 2);
    const meta = result.meta ?? {};

    // Calculate change from previous close
    const price = closes[closes.length - 1];
    const prevClose = meta.previousClose ?? closes[closes.length - 2] ?? price;
    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    // Apply market filter to match run-strategy logic
    let marketBullish = true;
    let marketAdjustment = 0;

    try {
      const niftyFull = await getMarketDataFull('^NSEI', { range: '1y', interval: '1d' });
      
      if (niftyFull.closes.length >= 30) {
        const niftyAnalysis = analyzeStock(
          niftyFull.closes,
          niftyFull.highs,
          niftyFull.lows,
          niftyFull.volumes
        );
        
        marketBullish = niftyAnalysis.trend === 'UPTREND';
        
        if (!marketBullish) {
          marketAdjustment = -10;
          analysis.score = Math.max(0, analysis.score + marketAdjustment);
          analysis.signals.push('Score adjusted -10 (bear market / NIFTY downtrend)');
          
          // Re-evaluate decision after adjustment
          if (analysis.score >= 70) {
            analysis.decision = 'BUY';
          } else if (analysis.score >= 50) {
            analysis.decision = 'HOLD';
          } else {
            analysis.decision = 'AVOID';
          }
        }
      }
    } catch (err) {
      console.warn('[analyze] NIFTY market filter failed:', err);
      // Continue without market filter if NIFTY data fails
    }

    // Build response with all required fields for UI
    const response: AnalysisResult & {
      symbol: string;
      shortName: string;
      currency: string;
      exchange: string;
      marketBullish: boolean;
      marketAdjustment: number;
    } = {
      symbol: (meta.symbol as string) ?? symbol,
      shortName: (meta.shortName as string) ?? symbol.replace('.NS', ''),
      currency: (meta.currency as string) ?? 'INR',
      exchange: (meta.exchangeName as string) ?? 'NSE',
      marketBullish,
      marketAdjustment,
      ...analysis,
      price,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
    };

    return Response.json(response);
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