import { getSupabase } from '@/lib/supabase';

export async function GET() {
  const supabase = getSupabase();

  try {
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('status', 'CLOSED');

    if (error) throw error;

    if (!trades || trades.length === 0) {
      return Response.json({
        totalTrades: 0,
        winRate: 0,
        totalProfit: 0,
        avgProfit: 0,
        bestTrade: 0,
        worstTrade: 0
      });
    }

    let totalProfit = 0;
    let wins = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;

    for (const t of trades) {
      const pnl =
        (t.sell_price - t.buy_price) * t.quantity;

      totalProfit += pnl;

      if (pnl > 0) wins++;

      if (pnl > bestTrade) bestTrade = pnl;
      if (pnl < worstTrade) worstTrade = pnl;
    }

    const totalTrades = trades.length;
    const winRate = (wins / totalTrades) * 100;
    const avgProfit = totalProfit / totalTrades;

    return Response.json({
      totalTrades,
      winRate: Number(winRate.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      avgProfit: Number(avgProfit.toFixed(2)),
      bestTrade: Number(bestTrade.toFixed(2)),
      worstTrade: Number(worstTrade.toFixed(2))
    });

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}