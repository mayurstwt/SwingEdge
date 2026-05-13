import { getSupabase } from '@/lib/supabase';
import { getISTNow } from '@/lib/market-hours';

export async function GET() {
  const supabase = getSupabase();
  const istNow = getISTNow();
  const today = istNow.dateStr;

  try {
    // First try to get signals from today

    const { data: initialSignals, error } = await supabase
      .from('signals')
      .select('*')
      .eq('run_date', today)
      .order('score', { ascending: false });
    
    let signals = initialSignals;
    
    if (error) throw error;
    
    // If no signals today, get the most recent run
    if (!signals || signals.length === 0) {
      const { data: latestRun } = await supabase
        .from('signals')
        .select('run_date')
        .order('run_date', { ascending: false })
        .limit(1)
        .single();
      
      if (latestRun) {
        const { data: recentSignals } = await supabase
          .from('signals')
          .select('*')
          .eq('run_date', latestRun.run_date)
          .order('score', { ascending: false });
        
        signals = recentSignals;
      }
    }
    
    return Response.json({
      signals: signals ?? [],
      run_date: today,
      last_updated_at: new Date().toISOString(),
      fetched_at: today
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch signals';
    return Response.json({ error: message }, { status: 500 });
  }
}
