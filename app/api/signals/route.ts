import { getSupabase } from '@/lib/supabase';

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  // Try today first, fall back to most recent run date
  let { data, error } = await getSupabase()
    .from('signals')
    .select('*')
    .eq('run_date', today)
    .order('score', { ascending: false });

  if (!error && (!data || data.length === 0)) {
    // No signals for today — get most recent available date
    const { data: latest } = await getSupabase()
      .from('signals')
      .select('run_date')
      .order('run_date', { ascending: false })
      .limit(1)
      .single();

    if (latest?.run_date) {
      const result = await getSupabase()
        .from('signals')
        .select('*')
        .eq('run_date', latest.run_date)
        .order('score', { ascending: false });
      data = result.data;
      error = result.error;
    }
  }

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ signals: data ?? [], run_date: data?.[0]?.run_date ?? null });
}
