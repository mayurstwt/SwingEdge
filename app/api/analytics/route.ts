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
      return Response.json({ message: 'No trades yet' });
    }

    let totalProfit = 0;
    let wins = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;

    // 🔥 GROUPING OBJECTS
    const entryStats: any = {};
    const sectorStats: any = {};
    const rrStats: any = {};

    for (const t of trades) {
      const pnl = (t.sell_price - t.buy_price) * t.quantity;

      totalProfit += pnl;
      if (pnl > 0) wins++;

      if (pnl > bestTrade) bestTrade = pnl;
      if (pnl < worstTrade) worstTrade = pnl;

      // 🔥 ENTRY TYPE ANALYSIS
      const entry = t.entry_type || 'UNKNOWN';
      if (!entryStats[entry]) {
        entryStats[entry] = { trades: 0, profit: 0, wins: 0 };
      }
      entryStats[entry].trades++;
      entryStats[entry].profit += pnl;
      if (pnl > 0) entryStats[entry].wins++;

      // 🔥 SECTOR ANALYSIS
      const sector = t.sector || 'UNKNOWN';
      if (!sectorStats[sector]) {
        sectorStats[sector] = { trades: 0, profit: 0 };
      }
      sectorStats[sector].trades++;
      sectorStats[sector].profit += pnl;

      // 🔥 R:R ANALYSIS
      const rr = t.risk_reward ? Math.round(t.risk_reward) : 'UNKNOWN';
      if (!rrStats[rr]) {
        rrStats[rr] = { trades: 0, profit: 0 };
      }
      rrStats[rr].trades++;
      rrStats[rr].profit += pnl;
    }

    const totalTrades = trades.length;
    const winRate = (wins / totalTrades) * 100;
    const avgProfit = totalProfit / totalTrades;

    // 🔥 FORMAT ENTRY STATS
    const formattedEntryStats = Object.entries(entryStats).map(([key, val]: any) => ({
      type: key,
      trades: val.trades,
      winRate: ((val.wins / val.trades) * 100).toFixed(2),
      profit: Number(val.profit.toFixed(2))
    }));

    // 🔥 FORMAT SECTOR STATS
    const formattedSectorStats = Object.entries(sectorStats).map(([key, val]: any) => ({
      sector: key,
      trades: val.trades,
      profit: Number(val.profit.toFixed(2))
    }));

    // 🔥 FORMAT RR STATS
    const formattedRRStats = Object.entries(rrStats).map(([key, val]: any) => ({
      rr: key,
      trades: val.trades,
      profit: Number(val.profit.toFixed(2))
    }));

    return Response.json({
      // 🔹 overall
      totalTrades,
      winRate: Number(winRate.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      avgProfit: Number(avgProfit.toFixed(2)),
      bestTrade: Number(bestTrade.toFixed(2)),
      worstTrade: Number(worstTrade.toFixed(2)),

      // 🔥 intelligence
      entryTypeStats: formattedEntryStats,
      sectorStats: formattedSectorStats,
      rrStats: formattedRRStats
    });

  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}