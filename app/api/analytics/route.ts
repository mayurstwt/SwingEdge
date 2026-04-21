import { getSupabaseAdmin } from '@/lib/supabase';
import { buildLiveEquityCurve, calculateDrawdownCurve, summarizeStrategyPerformance } from '@/lib/trading/performance';

export async function GET() {
  const supabase = getSupabaseAdmin();

  try {
    const [{ data: trades, error }, { data: wallet }] = await Promise.all([
      supabase.from('trades').select('*').eq('status', 'CLOSED'),
      supabase.from('wallet').select('balance').eq('id', 1).single(),
    ]);

    if (error) throw error;

    if (!trades || trades.length === 0) {
      return Response.json({ message: 'No trades yet' });
    }

    let totalProfit = 0;
    let wins = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;

    // 🔥 GROUPING OBJECTS
    const entryStats: Record<string, { trades: number; profit: number; wins: number }> = {};
    const sectorStats: Record<string, { trades: number; profit: number; wins: number }> = {};
    const rrStats: Record<string, { trades: number; profit: number }> = {};

    for (const t of trades) {
      const pnl = Number(t.profit_loss ?? ((Number(t.sell_price ?? 0) - Number(t.buy_price)) * Number(t.quantity)));

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
        sectorStats[sector] = { trades: 0, profit: 0, wins: 0 };
      }
      sectorStats[sector].trades++;
      sectorStats[sector].profit += pnl;
      if (pnl > 0) sectorStats[sector].wins++;

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
    const formattedEntryStats = Object.entries(entryStats).map(([key, val]) => ({
      type: key,
      trades: val.trades,
      winRate: ((val.wins / val.trades) * 100).toFixed(2),
      profit: Number(val.profit.toFixed(2))
    }));

    const formattedSectorStats = Object.entries(sectorStats).map(([key, val]) => ({
      sector: key,
      trades: val.trades,
      profit: Number(val.profit.toFixed(2)),
      winRate: Number(((val.wins / val.trades) * 100).toFixed(2)),
    }));

    const formattedRRStats = Object.entries(rrStats).map(([key, val]) => ({
      rr: key,
      trades: val.trades,
      profit: Number(val.profit.toFixed(2))
    }));

    const strategyPerformance = summarizeStrategyPerformance(
      trades.map((trade) => ({
        entryType: (trade.entry_type || 'UNKNOWN') as 'BREAKOUT' | 'PULLBACK' | 'MOMENTUM' | 'UNKNOWN',
        netPnl: Number(trade.profit_loss ?? 0),
        riskReward: trade.risk_reward ? Number(trade.risk_reward) : null,
      }))
    );

    if (strategyPerformance.length > 0) {
      await supabase.from('strategy_performance').upsert(
        strategyPerformance.map((item) => ({
          entry_type: item.entryType,
          avg_profit: item.avgProfit,
          win_rate: item.winRate,
          trades_count: item.tradesCount,
          total_profit: item.totalProfit,
          dynamic_score_threshold: item.dynamicScoreThreshold,
          capital_weight: item.capitalWeight,
          enabled: item.enabled,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'entry_type' }
      );
    }

    const startingCapital = Number(wallet?.balance ?? 50000);
    const equityCurve = buildLiveEquityCurve(trades, Math.max(startingCapital, 50000));
    const drawdownCurve = calculateDrawdownCurve(equityCurve);
    const bestStrategy = strategyPerformance[0] ?? null;
    const worstStrategy = strategyPerformance[strategyPerformance.length - 1] ?? null;

    return Response.json({
      totalTrades,
      winRate: Number(winRate.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      avgProfit: Number(avgProfit.toFixed(2)),
      bestTrade: Number(bestTrade.toFixed(2)),
      worstTrade: Number(worstTrade.toFixed(2)),
      entryTypeStats: formattedEntryStats.sort((a, b) => b.profit - a.profit),
      sectorStats: formattedSectorStats,
      rrStats: formattedRRStats,
      strategyPerformance,
      equityCurve,
      drawdownCurve,
      bestStrategy,
      worstStrategy,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Analytics failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
