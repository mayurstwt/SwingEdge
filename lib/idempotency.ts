import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getOrCreateStrategyRun(runKey: string) {
  // Check if this run already exists
  const { data: existingRun } = await supabase
    .from('strategy_runs')
    .select('id, status')
    .eq('run_key', runKey)
    .single();

  if (existingRun) {
    if (existingRun.status === 'SUCCESS') {
      return { 
        isNewRun: false, 
        reason: 'Already completed',
        runId: existingRun.id 
      };
    }
    if (existingRun.status === 'PENDING') {
      return { 
        isNewRun: false, 
        reason: 'Already in progress',
        runId: existingRun.id 
      };
    }
  }

  // Create new run
  const { data: newRun, error } = await supabase
    .from('strategy_runs')
    .insert({
      run_key: runKey,
      run_timestamp: new Date().toISOString(),
      status: 'PENDING',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  return { 
    isNewRun: true, 
    runId: newRun.id 
  };
}

export async function updateStrategyRun(
  runId: string,
  updates: {
    status: 'SUCCESS' | 'FAILED';
    error_message?: string;
    trades_opened?: number;
    trades_closed?: number;
    duration_ms?: number;
    log_summary?: string;
  }
) {
  const { data, error } = await supabase
    .from('strategy_runs')
    .update({
      ...updates,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
