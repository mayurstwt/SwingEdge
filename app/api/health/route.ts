import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const checks = {
    supabase: false,
    env: false,
    timestamp: new Date().toISOString(),
  };

  // Check environment variables
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET',
  ];

  checks.env = requiredEnv.every(key => process.env[key]);

  // Check Supabase connection
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await supabase.from('wallet').select('balance').limit(1);
    checks.supabase = !!data;
  } catch (e) {
    checks.supabase = false;
  }

  const healthy = checks.env && checks.supabase;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      message: healthy
        ? 'All systems operational'
        : 'Some checks failed',
    },
    { status: healthy ? 200 : 503 }
  );
}
