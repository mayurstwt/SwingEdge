import stocks from '@/data/stocks.json';
import { getISTNow } from '@/lib/market-hours';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateTipsForCandidates, inferMarketTrend, persistTradeTips, type TipCandidate } from '@/lib/tips';

export const dynamic = 'force-dynamic';

const stockLookup = new Map(stocks.map((stock) => [stock.symbol, stock]));

function isMissingTradeTipsTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || error.message?.toLowerCase().includes('trade_tips') === true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbols = Array.isArray(body.symbols)
      ? body.symbols.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const runId = typeof body.runId === 'string' ? body.runId : undefined;
    const supabase = getSupabaseAdmin();
    const istNow = getISTNow();

    let query = supabase
      .from('signals')
      .select('*')
      .eq('run_date', istNow.dateStr)
      .gte('score', 60)
      .order('score', { ascending: false });

    if (symbols.length > 0) {
      query = query.in('symbol', symbols);
    }

    const { data: signals, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const candidates = (signals ?? [])
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

    const marketTrend = await inferMarketTrend();
    const tips = await generateTipsForCandidates(candidates, marketTrend);
    const generated = await persistTradeTips(tips);

    return Response.json({
      generated,
      tips,
      marketTrend,
    });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && isMissingTradeTipsTable(err as { code?: string; message?: string })) {
      return Response.json({
        error: 'trade_tips table is not created yet. Apply supabase/schema.sql to enable Smart Trade Tips.',
      }, { status: 400 });
    }
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
