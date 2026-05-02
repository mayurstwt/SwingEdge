import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function checkDrawdownLimit(maxDrawdownPercent: number = 20) {
  const today = new Date().toISOString().split('T')[0];

  // Get starting balance
  const { data: stats } = await supabase
    .from('daily_stats')
    .select('starting_balance, starting_equity')
    .eq('run_date', today)
    .single();

  if (!stats) {
    return { breached: false, reason: 'No daily stats found' };
  }

  // Get current equity
  const { data: wallet } = await supabase
    .from('wallet')
    .select('balance')
    .single();

  const { data: trades } = await supabase
    .from('trades')
    .select('buy_price, quantity, sell_price')
    .eq('status', 'OPEN');

  let currentEquity = wallet?.balance ?? 0;
  
  // Add unrealized P&L
  trades?.forEach(trade => {
    const cost = trade.buy_price * trade.quantity;
    const currentValue = (trade.sell_price || trade.buy_price) * trade.quantity;
    currentEquity += currentValue - cost;
  });

  const startingEquity = stats.starting_equity || stats.starting_balance;
  if (!startingEquity) {
    return { breached: false, reason: 'No starting equity available' };
  }

  const drawdown = 1 - (currentEquity / startingEquity);
  const drawdownPercent = drawdown * 100;

  return {
    breached: drawdownPercent > maxDrawdownPercent,
    drawdownPercent: Math.round(drawdownPercent * 100) / 100,
    currentEquity,
    startingEquity: stats.starting_equity,
  };
}
