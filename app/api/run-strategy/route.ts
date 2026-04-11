import axios from 'axios';
import { analyzeStock } from '@/lib/strategy';
import { getSupabase } from '@/lib/supabase';

// ── Priority stocks to analyze daily (top 15 for speed) ──────
const PRIORITY_STOCKS = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
  { symbol: 'TCS.NS',      name: 'TCS' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
  { symbol: 'INFY.NS',     name: 'Infosys' },
  { symbol: 'ICICIBANK.NS',name: 'ICICI Bank' },
  { symbol: 'SBIN.NS',     name: 'State Bank of India' },
  { symbol: 'BAJFINANCE.NS',name: 'Bajaj Finance' },
  { symbol: 'MARUTI.NS',   name: 'Maruti Suzuki' },
  { symbol: 'SUNPHARMA.NS',name: 'Sun Pharma' },
  { symbol: 'WIPRO.NS',    name: 'Wipro' },
  { symbol: 'TATAMOTORS.NS',name: 'Tata Motors' },
  { symbol: 'AXISBANK.NS', name: 'Axis Bank' },
  { symbol: 'TITAN.NS',    name: 'Titan Company' },
  { symbol: 'ZOMATO.NS',   name: 'Zomato' },
  { symbol: 'ADANIPORTS.NS',name: 'Adani Ports' },
];

async function fetchAndAnalyze(symbol: string, name: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 12000,
  });

  const result = res.data?.chart?.result?.[0];
  if (!result) throw new Error('No data');

  const quote = result.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = result.timestamp ?? [];

  const rows = timestamps
    .map((ts: number, i: number) => ({
      close: (quote.close ?? [])[i],
      high:  (quote.high ?? [])[i],
      low:   (quote.low ?? [])[i],
      volume:(quote.volume ?? [])[i],
    }))
    .filter(r => r.close !== null && r.high !== null && r.low !== null && r.volume !== null);

  if (rows.length < 30) throw new Error('Not enough data');

  const analysis = analyzeStock(
    rows.map(r => r.close),
    rows.map(r => r.high),
    rows.map(r => r.low),
    rows.map(r => r.volume)
  );

  const meta = result.meta ?? {};
  return { analysis, shortName: meta.shortName ?? name };
}

export async function POST(req: Request) {
  // ── Security: validate cron secret ──────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';

  if (cronSecret && !isDev) {
    const incoming = req.headers.get('x-cron-secret');
    if (incoming !== cronSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const processed: string[] = [];
  const errors: { symbol: string; error: string }[] = [];

  for (const stock of PRIORITY_STOCKS) {
    try {
      const { analysis, shortName } = await fetchAndAnalyze(stock.symbol, stock.name);

      const { error } = await getSupabase()
        .from('signals')
        .upsert(
          {
            symbol:     stock.symbol,
            short_name: shortName,
            decision:   analysis.decision,
            score:      analysis.score,
            confidence: analysis.confidence,
            price:      analysis.price,
            stop_loss:  analysis.stopLoss,
            target:     analysis.target,
            rsi:        analysis.rsi,
            trend:      analysis.trend,
            change_pct: analysis.changePercent,
            run_date:   today,
          },
          { onConflict: 'symbol,run_date' }
        );

      if (error) throw new Error(error.message);
      processed.push(stock.symbol);

      // Small delay to avoid hammering Yahoo Finance
      await new Promise(r => setTimeout(r, 400));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ symbol: stock.symbol, error: msg });
    }
  }

  return Response.json({
    run_date: today,
    processed: processed.length,
    errors: errors.length,
    symbols_ok: processed,
    symbols_failed: errors,
  });
}
