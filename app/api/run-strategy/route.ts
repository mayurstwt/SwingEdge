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
    .map((_, i) => ({
      close: quote.close?.[i],
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      volume: quote.volume?.[i],
    }))
    .filter((r): r is { close: number; open: number; high: number; low: number; volume: number } =>
      r.close != null && r.open != null && r.high != null && r.low != null && r.volume != null
    );

  if (rows.length < 30) throw new Error(`Not enough history`);

  const analysis = analyzeStock(
    rows.map(r => r.close),
    rows.map(r => r.high),
    rows.map(r => r.low),
    rows.map(r => r.volume)
  );

  return {
    analysis,
    currentPrice: rows[rows.length - 1].close,
    shortName: result.meta?.shortName ?? name
  };
}

export async function POST(req: Request) {
  const supabase = getSupabase();
  const todayStr = new Date().toISOString().split('T')[0];

  const results = {
    processed: 0,
    auto_buys: [] as string[],
    auto_sells: [] as string[],
    logs: [] as string[]
  };

  try {
    const [
      { data: wallet },
      { data: openTrades }
    ] = await Promise.all([
      supabase.from('wallet').select('balance').eq('id', 1).single(),
      supabase.from('trades').select('*').eq('status', 'OPEN')
    ]);

    const currentBalance = wallet?.balance ?? 0;
    const currentEquity = (openTrades ?? []).reduce(
      (sum, t: any) => sum + (t.buy_price * t.quantity),
      0
    );

    const totalValue = currentBalance + currentEquity;

    const MAX_OPEN_TRADES = 5;
    const MAX_CAPITAL_USAGE = 0.7;

    const openTradesCount = openTrades?.length || 0;
    const capitalUsagePct = currentEquity / (totalValue || 1);

    // 🔥 MARKET FILTER
    let marketBullish = true;
    try {
      const nifty = await fetchAndAnalyze('^NSEI', 'NIFTY 50');
      marketBullish = nifty.analysis.trend === 'UPTREND' && nifty.analysis.rsi > 50;
    } catch {}

    for (const stockInfo of PRIORITY_STOCKS) {
      try {
        const { analysis, currentPrice, shortName } =
          await fetchAndAnalyze(stockInfo.symbol, stockInfo.name);

        await supabase.from('signals').upsert({
          symbol: stockInfo.symbol,
          short_name: shortName,
          decision: analysis.decision,
          score: analysis.score,
          price: currentPrice,
          stop_loss: analysis.stopLoss,
          target: analysis.target,
          rsi: analysis.rsi,
          reason: analysis.reason,
          trend: analysis.trend,
          change_pct: analysis.changePercent,
          run_date: todayStr,
          updated_at: new Date().toISOString()
        }, { onConflict: 'symbol,run_date' });

        const existingTrade = openTrades?.find(
          (t: any) => t.symbol === stockInfo.symbol
        );

        if (existingTrade) {
          let sellReason = '';

          // ✅ 1. TRAILING SL (always run)
          if (existingTrade.stop_loss) {
            const atr =
              analysis?.atr ||
              Math.abs(currentPrice - existingTrade.stop_loss) ||
              5;

            const newSL = currentPrice - atr * 1.5;

            if (newSL > existingTrade.stop_loss) {
              await supabase
                .from('trades')
                .update({ stop_loss: Number(newSL.toFixed(2)) })
                .eq('id', existingTrade.id);
            }
          }

          // ✅ 2. PARTIAL PROFIT BOOKING (independent)
          if (existingTrade.target && currentPrice >= existingTrade.target) {
            const halfQty = Math.floor(existingTrade.quantity / 2);

            if (halfQty > 0) {
              await executeAutoSell(
                { ...existingTrade, quantity: halfQty },
                currentPrice,
                'Partial Profit Booking'
              );

              await supabase
                .from('trades')
                .update({
                  quantity: existingTrade.quantity - halfQty,
                  target: null
                })
                .eq('id', existingTrade.id);

              results.logs.push(`${existingTrade.symbol} Partial Booked`);
              continue; // ⚠️ skip further checks
            } else {
              sellReason = 'Final Target Hit';
            }
          }

          // ✅ 3. EXIT CONDITIONS
          if (analysis.decision === 'AVOID')
            sellReason = 'Signal flip';
          else if (currentPrice <= existingTrade.stop_loss)
            sellReason = 'Stop loss hit';

          if (sellReason) {
            await executeAutoSell(existingTrade, currentPrice, sellReason);
            results.auto_sells.push(stockInfo.symbol);
          }

        } else {
          const volumeOk = analysis.volumeRatio > 1.5;

          if (
            marketBullish &&
            analysis.decision === 'BUY' &&
            analysis.score >= 70 &&
            volumeOk &&
            openTradesCount < MAX_OPEN_TRADES &&
            capitalUsagePct < MAX_CAPITAL_USAGE
          ) {
            const res = await executeAutoBuy(
              stockInfo.symbol,
              shortName,
              currentPrice,
              analysis.stopLoss,
              analysis.target,
              analysis.reason,
              stockInfo.sector
            );

            if (res.success) results.auto_buys.push(stockInfo.symbol);
          }
        }

        results.processed++;
      } catch (err: any) {
        results.logs.push(`${stockInfo.symbol}: ${err.message}`);
      }
    }

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }

  return Response.json(results);
}