import { getSupabase } from '@/lib/supabase';
import { GET as getAnalytics } from '@/app/api/analytics/route';

export async function GET() {
  try {
    const supabase = getSupabase();

    const [analyticsRaw, latestBacktestRes, strategyRes] = await Promise.all([
      getAnalytics(),
      supabase.from('backtest_runs').select('*').order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('strategy_performance').select('*').order('total_profit', { ascending: false }),
    ]);
    const analyticsResponse = analyticsRaw.ok ? await analyticsRaw.json() : null;

    const latestBacktest = latestBacktestRes.data;
    let backtestTrades: unknown[] = [];

    if (latestBacktest?.id) {
      const tradesRes = await supabase
        .from('backtest_trades')
        .select('*')
        .eq('run_id', latestBacktest.id)
        .order('entry_date', { ascending: true });
      backtestTrades = tradesRes.data ?? [];
    }

    return Response.json({
      analytics: analyticsResponse,
      latestBacktest,
      backtestTrades,
      strategyPerformance: strategyRes.data ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load performance dashboard';
    return Response.json({ error: message }, { status: 500 });
  }
}
