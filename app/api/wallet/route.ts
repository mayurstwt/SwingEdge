import { getSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('status', 'CLOSED');

    const closedTrades = trades ?? [];
    
    if (closedTrades.length === 0) {
      return Response.json({
        winRate: 0,
        totalTrades: 0,
        avgProfit: 0,
        bestTrade: 0,
        worstTrade: 0,
      });
    }

    const profits = closedTrades.map(t => Number(t.profit_loss ?? 0));
    const winningTrades = profits.filter(p => p > 0);
    const losingTrades = profits.filter(p => p <= 0);

    const winRate = Math.round((winningTrades.length / profits.length) * 100);
    const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const bestTrade = Math.max(...profits);
    const worstTrade = Math.min(...profits);

    return Response.json({
      winRate,
      totalTrades: profits.length,
      avgProfit: Number(avgProfit.toFixed(2)),
      bestTrade: Number(bestTrade.toFixed(2)),
      worstTrade: Number(worstTrade.toFixed(2)),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Analytics failed';
    return Response.json({ error: message }, { status: 500 });
  }
}