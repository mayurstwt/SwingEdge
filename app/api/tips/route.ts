import stocks from '@/data/stocks.json';
import { getISTNow } from '@/lib/market-hours';
import { getSupabase, getSupabaseAdmin } from '@/lib/supabase';
import { generateTipsForCandidates, inferMarketTrend, persistTradeTips, type TipCandidate } from '@/lib/tips';

export const dynamic = 'force-dynamic';

function isMissingTradeTipsTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || error.message?.toLowerCase().includes('trade_tips') === true;
}

function buildStockLookup() {
  return new Map(stocks.map((stock) => [stock.symbol, stock]));
}

async function loadCandidates(symbols?: string[], runId?: string): Promise<TipCandidate[]> {
  const supabase = getSupabaseAdmin();
  const istNow = getISTNow();
  const stockLookup = buildStockLookup();

  let query = supabase
    .from('signals')
    .select('*')
    .eq('run_date', istNow.dateStr)
    .gte('score', 60)
    .order('score', { ascending: false });

  if (symbols && symbols.length > 0) {
    query = query.in('symbol', symbols);
  }

  const { data: todaySignals, error } = await query;
  if (error) {
    throw new Error(`Failed to load signals for tips: ${error.message}`);
  }

  const signals = todaySignals ?? [];
  return signals
    .map<TipCandidate | null>((signal) => {
      const stock = stockLookup.get(signal.symbol);
      if (!stock || !signal.price || !signal.stop_loss || !signal.target || !signal.trend) {
        return null;
      }

      return {
        symbol: signal.symbol,
        shortName: stock.name,
        sector: stock.sector,
        technicalScore: signal.score,
        price: Number(signal.price),
        stopLoss: Number(signal.stop_loss),
        target: Number(signal.target),
        riskReward: signal.target && signal.stop_loss && signal.price
          ? Number(((Number(signal.target) - Number(signal.price)) / (Number(signal.price) - Number(signal.stop_loss))).toFixed(2))
          : null,
        trend: signal.trend,
        signals: signal.reason ? String(signal.reason).split(', ').filter(Boolean) : [],
        runId,
      };
    })
    .filter((candidate): candidate is TipCandidate => candidate !== null);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supabase = getSupabase();
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const limit = Number(searchParams.get('limit') ?? '20');

    let query = supabase
      .from('trade_tips')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 100)));

    if (status) {
      query = query.eq('status', status);
    }

    if (type) {
      query = query.eq('tip_type', type);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingTradeTipsTable(error)) {
        return Response.json({
          tips: [],
          fetchedAt: new Date().toISOString(),
          schemaReady: false,
          message: 'trade_tips table is not created yet. Apply supabase/schema.sql to enable Smart Trade Tips.',
        });
      }
      throw error;
    }

    return Response.json({
      tips: data ?? [],
      fetchedAt: new Date().toISOString(),
      schemaReady: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch trade tips';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbols = Array.isArray(body.symbols)
      ? body.symbols.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : typeof body.symbol === 'string' && body.symbol
        ? [body.symbol]
        : undefined;
    const runId = typeof body.runId === 'string' ? body.runId : undefined;

    const candidates = await loadCandidates(symbols, runId);
    const marketTrend = await inferMarketTrend();
    const tips = await generateTipsForCandidates(candidates, marketTrend);
    const saved = await persistTradeTips(tips);

    return Response.json({
      generated: saved,
      tips,
      marketTrend,
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'message' in err &&
      typeof (err as { message: string }).message === 'string' &&
      (err as { message: string }).message.toLowerCase().includes('trade_tips')
    ) {
      return Response.json({
        error: 'trade_tips table is not created yet. Apply supabase/schema.sql to enable Smart Trade Tips.',
      }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Failed to generate trade tips';
    return Response.json({ error: message }, { status: 500 });
  }
}
