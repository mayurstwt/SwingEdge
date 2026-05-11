import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STALE_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function getOrCreateStrategyRun(runKey: string) {
  // Check if this run already exists
  const { data: existingRun } = await supabase
    .from('strategy_runs')
    .select('id, status, started_at')
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
      // Check if the PENDING lock is stale (older than 10 minutes)
      const startedAt = new Date(existingRun.started_at).getTime();
      const elapsed = Date.now() - startedAt;

      if (elapsed > STALE_LOCK_TIMEOUT_MS) {
        // Stale lock — mark as FAILED so we can retry
        console.warn(`🔓 Stale PENDING lock detected for ${runKey} (${Math.round(elapsed / 1000)}s old). Marking as FAILED.`);
        await supabase
          .from('strategy_runs')
          .update({
            status: 'FAILED',
            error_message: `Stale lock cleanup: PENDING for ${Math.round(elapsed / 1000)}s`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', existingRun.id);
        // Fall through to create a new run below
      } else {
        return { 
          isNewRun: false, 
          reason: 'Already in progress',
          runId: existingRun.id 
        };
      }
    }

    // FAILED runs are allowed to retry — fall through to create new run
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
