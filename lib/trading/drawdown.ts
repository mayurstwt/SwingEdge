import { getSupabaseAdmin } from '@/lib/supabase';
import { getISTNow } from '@/lib/market-hours';
import { fetchYahooChart } from '@/lib/yahoo-finance';

/**
 * Checks if the current equity has dropped significantly below the daily starting equity.
 * Real-time equity = current cash + current market value of open positions.
 * 
 * @param maxDrawdownPercent — The percentage threshold to trigger protection (default: 20%)
 */
export async function checkDrawdownLimit(maxDrawdownPercent: number = 20) {
  const istNow = getISTNow();
  const today = istNow.dateStr;
  const supabase = getSupabaseAdmin();

  // 1. Get starting balance/equity for the day
  // This was recorded by the first cron run of the day
  const { data: stats } = await supabase
    .from('daily_stats')
    .select('starting_balance, starting_equity')
    .eq('run_date', today)
    .single();

  if (!stats) {
    // If no stats found, we haven't initialized today's baseline yet
    return { breached: false, reason: 'No daily stats found for today' };
  }

  // 2. Get current cash balance
  const { data: wallet } = await supabase
    .from('wallet')
    .select('balance')
    .eq('id', 1)
    .single();

  if (!wallet) {
    return { breached: false, reason: 'Wallet not found' };
  }

  // 3. Get all open trades to calculate REAL-TIME unrealized equity
  const { data: trades } = await supabase
    .from('trades')
    .select('symbol, buy_price, quantity')
    .eq('status', 'OPEN');

  let currentEquity = wallet.balance;
  
  // 4. Fetch live prices for open trades
  if (trades && trades.length > 0) {
    // We use Promise.all to fetch prices in parallel for speed
    const pricePromises = trades.map(async (trade) => {
      try {
        // Fetch 1-day, 1-minute data just to get the regularMarketPrice meta
        const result = await fetchYahooChart(trade.symbol, '1d', '1m', 5000, 1);
        const livePrice = result.meta?.regularMarketPrice as number ?? trade.buy_price;
        return livePrice * trade.quantity;
      } catch (err) {
        console.warn(`Drawdown check: price fetch failed for ${trade.symbol}, using entry price`);
        return trade.buy_price * trade.quantity;
      }
    });

    const positionValues = await Promise.all(pricePromises);
    const totalPositionValue = positionValues.reduce((sum, val) => sum + val, 0);
    currentEquity += totalPositionValue;
  }

  const startingEquity = stats.starting_equity || stats.starting_balance;
  if (!startingEquity || startingEquity <= 0) {
    return { breached: false, reason: 'Invalid starting equity' };
  }

  // 5. Calculate drawdown percentage
  // Drawdown = 1 - (Current / Starting)
  const drawdown = 1 - (currentEquity / startingEquity);
  const drawdownPercent = drawdown * 100;

  return {
    breached: drawdownPercent > maxDrawdownPercent,
    drawdownPercent: Math.round(drawdownPercent * 100) / 100,
    currentEquity: Math.round(currentEquity * 100) / 100,
    startingEquity: startingEquity,
  };
}
