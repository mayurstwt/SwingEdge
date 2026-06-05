import { getSupabaseAdmin } from '@/lib/supabase';
import { executeTradeAtomic } from '@/lib/wallet';

type TipAction = 'BUY' | 'IGNORE' | 'DISMISS';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const action = body.action as TipAction;
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    if (!['BUY', 'IGNORE', 'DISMISS'].includes(action)) {
      return Response.json({ error: 'Invalid tip action' }, { status: 400 });
    }

    const { data: tip, error } = await supabase
      .from('trade_tips')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !tip) {
      return Response.json({ error: 'Trade tip not found' }, { status: 404 });
    }

    if (tip.status !== 'ACTIVE') {
      return Response.json({ error: `Tip is ${tip.status.toLowerCase()}` }, { status: 400 });
    }

    if (action === 'BUY') {
      const { data: existingOpenTrade } = await supabase
        .from('trades')
        .select('id')
        .eq('symbol', tip.symbol)
        .eq('status', 'OPEN')
        .limit(1)
        .maybeSingle();

      if (existingOpenTrade) {
        return Response.json({ error: 'An open trade already exists for this symbol' }, { status: 400 });
      }

      const trade = await executeTradeAtomic({
        symbol: tip.symbol,
        quantity: tip.suggested_qty,
        price: Number(tip.suggested_price),
        stopLoss: Number(tip.stop_loss),
        target: Number(tip.target),
        shortName: tip.short_name ?? undefined,
        sector: tip.sector ?? undefined,
        entryScore: tip.composite_score,
      });

      await supabase
        .from('trade_tips')
        .update({
          status: 'TRIGGERED',
          triggered_at: new Date().toISOString(),
          triggered_price: tip.suggested_price,
          user_action: 'BUY',
        })
        .eq('id', id);

      return Response.json({ success: true, action, trade });
    }

    await supabase
      .from('trade_tips')
      .update({
        status: 'CANCELLED',
        user_action: 'IGNORE',
      })
      .eq('id', id);

    return Response.json({ success: true, action });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Trade tip action failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
