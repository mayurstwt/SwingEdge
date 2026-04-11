import axios from 'axios';
import { analyzeStock } from '@/lib/strategy';
import { getSupabase } from '@/lib/supabase';
import { executeAutoBuy, executeAutoSell } from '@/lib/wallet';
import STOCKS_DATA from '@/data/stocks.json';

const PRIORITY_STOCKS = STOCKS_DATA.slice(0, 20);

async function fetchAndAnalyze(symbol: string, name: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
  const result = res.data?.chart?.result?.[0];
  if (!result) throw new Error('No data from Yahoo');

  const quote = result.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = result.timestamp ?? [];

  const rows = timestamps
    .map((ts: number, i: number) => ({
      close: (quote.close ?? [])[i] as number | null,
      open:  (quote.open ?? [])[i] as number | null,
      high:  (quote.high ?? [])[i] as number | null,
      low:   (quote.low ?? [])[i] as number | null,
      volume:(quote.volume ?? [])[i] as number | null,
    }))
    .filter((r: any): r is { close: number; open: number; high: number; low: number; volume: number } => 
      r.close !== null && r.open !== null && r.high !== null && r.low !== null && r.volume !== null
    );

  if (rows.length < 30) throw new Error(`Not enough history (${rows.length} days)`);

  const analysis = analyzeStock(
    rows.map((r: any) => r.close),
    rows.map((r: any) => r.high),
    rows.map((r: any) => r.low),
    rows.map((r: any) => r.volume)
  );

  const last20 = rows.slice(-20);
  const avgDailyValue = last20.reduce((sum: number, r: any) => sum + (r.close * r.volume), 0) / 20;

  const lastDay = rows[rows.length - 1];
  const prevDay = rows[rows.length - 2];
  const gapPct = ((lastDay.open - prevDay.close) / prevDay.close) * 100;

  return { analysis, avgDailyValue, gapPct, currentPrice: lastDay.close, shortName: result.meta?.shortName ?? name };
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

  // Use a stable date format (YYYY-MM-DD)
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  
  console.log(`[StrategyRun] Starting for ${todayStr}. Total stocks: ${PRIORITY_STOCKS.length}`);

  const supabase = getSupabase();
  const results = { processed: 0, auto_buys: [] as string[], auto_sells: [] as string[], logs: [] as string[] };

  try {
    // 1. Fetch Wallet & Open Trades & Daily Stats
    const [
      { data: wallet, error: wErr },
      { data: openTrades, error: tErr },
      { data: todayStats, error: tsErr }
    ] = await Promise.all([
      supabase.from('wallet').select('balance').eq('id', 1).single(),
      supabase.from('trades').select('*').eq('status', 'OPEN'),
      supabase.from('daily_stats').select('*').eq('run_date', todayStr).single()
    ]);

    if (wErr || tErr) throw new Error(`DB Connect Error: ${wErr?.message || tErr?.message}`);

    const currentBalance = wallet?.balance ?? 0;
    const currentEquity = (openTrades ?? []).reduce((sum: number, t: any) => sum + (Number(t.buy_price) * t.quantity), 0);
    const totalValue = currentBalance + currentEquity;

    // Initialize Daily Stats if missing
    let circuitBroken = todayStats?.is_circuit_broken ?? false;
    if (!todayStats) {
      await supabase.from('daily_stats').insert({
        run_date: todayStr,
        starting_balance: currentBalance,
        starting_equity: currentEquity,
      });
      console.log(`[StrategyRun] Initialized daily_stats for ${todayStr}`);
    } else {
      const startingTotal = Number(todayStats.starting_balance) + Number(todayStats.starting_equity);
      if (totalValue < startingTotal * 0.95) {
        circuitBroken = true;
        await supabase.from('daily_stats').update({ is_circuit_broken: true }).eq('run_date', todayStr);
      }
    }

    for (const stockInfo of PRIORITY_STOCKS) {
      try {
        const { analysis, avgDailyValue, gapPct, currentPrice, shortName } = await fetchAndAnalyze(stockInfo.symbol, stockInfo.name);

        const { error: sigErr } = await supabase.from('signals').upsert({
          symbol: stockInfo.symbol, short_name: shortName, decision: analysis.decision, score: analysis.score,
          price: currentPrice, stop_loss: analysis.stopLoss, target: analysis.target, rsi: analysis.rsi, reason: analysis.reason,
          trend: analysis.trend, change_pct: analysis.changePercent, run_date: todayStr,
        }, { onConflict: 'symbol,run_date' });

        if (sigErr) throw new Error(`Signal Upsert Failed: ${sigErr.message}`);

        // Automated Logic
        const existingTrade = openTrades?.find((t: any) => t.symbol === stockInfo.symbol);
        if (existingTrade) {
          let sellReason = "";
          const ageDays = (new Date(todayStr).getTime() - new Date(existingTrade.opened_at).getTime()) / (1000 * 3600 * 24);
          if (analysis.decision === 'AVOID') sellReason = `Signal flip: ${analysis.reason}`;
          else if (currentPrice <= (existingTrade.stop_loss || 0)) sellReason = "Hard Stop Loss triggered";
          else if (currentPrice >= (existingTrade.target || 999999)) sellReason = "Profit Target reached";
          else if (ageDays > 15) sellReason = "Time-Stop triggered";

          if (sellReason) {
            await executeAutoSell(existingTrade, currentPrice, sellReason);
            results.auto_sells.push(`${stockInfo.symbol}`);
          }
        } 
        else if (!circuitBroken && analysis.decision === 'BUY' && analysis.score >= 70) {
          const res = await executeAutoBuy(stockInfo.symbol, shortName, currentPrice, analysis.stopLoss, analysis.target, analysis.reason, stockInfo.sector);
          if (res.success) results.auto_buys.push(stockInfo.symbol);
          else results.logs.push(`${stockInfo.symbol} BUY Skipped: ${res.reason}`);
        }

        results.processed++;
      } catch (err: any) {
        results.logs.push(`${stockInfo.symbol}: ${err.message}`);
        console.error(`[StrategyRun] Error for ${stockInfo.symbol}:`, err.message);
      }
    }
  } catch (globalErr: any) {
    console.error(`[StrategyRun] Global Failure:`, globalErr.message);
    return Response.json({ error: globalErr.message }, { status: 500 });
  }

  console.log(`[StrategyRun] Success: ${results.processed} processed, ${results.auto_buys.length} buys.`);
  return Response.json({ run_date: todayStr, circuit_broken: results.logs.length > 0, ...results });
}
