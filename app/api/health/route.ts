import { getSupabaseAdmin } from '@/lib/supabase';

// ================================
// 🏥 HEALTH CHECK ENDPOINT
// ================================
// Returns a detailed system-health snapshot:
//   • Database connectivity & latency
//   • Required environment variables
//   • Node.js heap memory usage
//   • Process uptime
//
// HTTP 200 → all checks healthy
// HTTP 503 → one or more checks failed or degraded

interface CheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  message?: string;
  [key: string]: unknown;
}

export async function GET(): Promise<Response> {
  const startTime = Date.now();
  const checks: Record<string, CheckResult> = {};

  // ── 1. Database connectivity ──────────────────────────────────────────────
  try {
    const supabase = getSupabaseAdmin();
    const dbStart = Date.now();

    const { error } = await supabase
      .from('wallet')
      .select('balance')
      .limit(1);

    const dbLatency = Date.now() - dbStart;

    checks.database = {
      status:  error ? 'unhealthy' : 'healthy',
      latency: dbLatency,
      message: error ? error.message : 'Connected',
    };
  } catch (err) {
    checks.database = {
      status:  'unhealthy',
      latency: Date.now() - startTime,
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // ── 2. Required environment variables ─────────────────────────────────────
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET',
  ];
  const missingEnv = requiredEnv.filter(key => !process.env[key]);

  checks.environment = {
    status:  missingEnv.length === 0 ? 'healthy' : 'unhealthy',
    message:
      missingEnv.length === 0
        ? 'All required env vars present'
        : `Missing: ${missingEnv.join(', ')}`,
  };

  // ── 3. Memory usage ───────────────────────────────────────────────────────
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem       = process.memoryUsage();
    const heapUsed  = Math.round(mem.heapUsed  / 1024 / 1024); // MB
    const heapTotal = Math.round(mem.heapTotal / 1024 / 1024); // MB
    const heapRatio = mem.heapUsed / mem.heapTotal;

    checks.memory = {
      status:     heapRatio > 0.90 ? 'degraded' : 'healthy',
      heapUsedMB: heapUsed,
      heapTotalMB: heapTotal,
      heapRatioPct: Math.round(heapRatio * 100),
      message:
        heapRatio > 0.90
          ? `High heap usage: ${Math.round(heapRatio * 100)}%`
          : `Heap ${Math.round(heapRatio * 100)}% used`,
    };
  }

  // ── Overall status ────────────────────────────────────────────────────────
  const allValues = Object.values(checks);
  const overallStatus: 'healthy' | 'degraded' =
    allValues.every(c => c.status === 'healthy') ? 'healthy' : 'degraded';

  const totalLatency = Date.now() - startTime;

  return Response.json(
    {
      status:    overallStatus,
      timestamp: new Date().toISOString(),
      latency:   totalLatency,
      uptime:    typeof process.uptime === 'function' ? Math.round(process.uptime()) : null,
      checks,
    },
    { status: overallStatus === 'healthy' ? 200 : 503 }
  );
}
