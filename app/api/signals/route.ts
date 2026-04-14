import { getSupabase } from '@/lib/supabase';

export async function GET() {
  const supabase = getSupabase();
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Logic: 
  // 1. Try to find signals for the exact 'today' date.
  // 2. If empty, find the most recent available date in the signals table and return those.
  
  try {
    const { data: latestRun } = await supabase
      .from('signals')
      .select('run_date, updated_at')
      .order('run_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!latestRun) {
      return Response.json({ signals: [], run_date: null });
    }

    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('run_date', latestRun.run_date)
      .order('score', { ascending: false });

    if (error) throw error;

    return Response.json({ 
      signals: data ?? [], 
      run_date: latestRun.run_date,
      last_updated_at: latestRun.updated_at,
      fetched_at: today 
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
