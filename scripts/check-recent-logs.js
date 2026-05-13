const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://feglrfoxkvpolifypjlw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlZ2xyZm94a3Zwb2xpZnlwamx3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTkwMTgzNiwiZXhwIjoyMDkxNDc3ODM2fQ.W3BEdg03Yh3SOmId4MgPbtI__H3LbH89iTqyk6R9s3c';

const supabase = createClient(supabaseUrl, supabaseKey);

async function getRecentLogs() {
  console.log('Fetching last strategy run...');
  const { data: runs, error: runErr } = await supabase
    .from('strategy_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(3);

  if (runErr) {
    console.error('Error fetching runs:', runErr);
    return;
  }

  if (!runs || runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  for (const run of runs) {
    console.log('\n----------------------------------------');
    console.log(`Run ID: ${run.id}`);
    console.log(`Key: ${run.run_key}`);
    console.log(`Status: ${run.status}`);
    console.log(`Started At: ${run.started_at}`);
    console.log(`Error Message: ${run.error_message || 'None'}`);
    console.log(`Trades opened: ${run.trades_opened}, closed: ${run.trades_closed}`);

    const { data: logs, error: logErr } = await supabase
      .from('trade_logs')
      .select('*')
      .eq('strategy_run_id', run.id)
      .order('created_at', { ascending: true });

    if (logErr) {
      console.error(`Error fetching logs for run ${run.id}:`, logErr);
      continue;
    }

    console.log(`Logs (${logs ? logs.length : 0}):`);
    if (logs) {
      logs.forEach(log => {
        const symbolStr = log.symbol ? ` [${log.symbol}]` : '';
        const actionStr = log.action ? ` (${log.action})` : '';
        const metadataStr = log.metadata ? ` | meta: ${JSON.stringify(log.metadata)}` : '';
        console.log(`  [${log.level}] ${log.message}${symbolStr}${actionStr}${metadataStr}`);
      });
    }
  }
}

getRecentLogs();
