import { getSupabase } from '@/lib/supabase';
import { calculateCharges } from '@/lib/wallet';

export async function GET() {
  try {
    const supabase = getSupabase();
    
    // Get latest signal date to fetch 'current' prices
    const { data: latestRun } = await supabase.from('signals').select('run_date').order('run_date', { ascending: false }).limit(1).single();
    
    const [walletRes, tradesRes, ledgerRes, signalsRes] = await Promise.all([
      supabase.from('wallet').select('*').eq('id', 1).single(),
      supabase.from('trades').select('*').order('opened_at', { ascending: false }),
      supabase.from('ledger').select('*').order('created_at', { ascending: false }),
      latestRun ? supabase.from('signals').select('symbol, price').eq('run_date', latestRun.run_date) : Promise.resolve({ data: [] }),
    ]);

    return Response.json({
      balance: walletRes.data?.balance ?? 0,
      trades:  tradesRes.data ?? [],
      ledger:  ledgerRes.data ?? [],
      signals: signalsRes.data ?? [],
    });
  } catch {
    return Response.json({ error: 'DB Connection Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase();
    const body = await req.json();
    const { action } = body;

    // 1. Action: Deposit
    if (action === 'deposit') {
      const { amount } = body;
      if (!amount || amount <= 0) return Response.json({ error: 'Invalid amount' }, { status: 400 });

      const { data: wallet } = await supabase.from('wallet').select('balance').eq('id', 1).single();
      const newBalance = (wallet?.balance ?? 0) + amount;

      await Promise.all([
        supabase.from('wallet').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('id', 1),
        supabase.from('ledger').insert({ type: 'CREDIT', amount, description: 'Cash Deposit' }),
      ]);
      return Response.json({ success: true, balance: newBalance });
    }

    // 1b. Action: Withdraw
    if (action === 'withdraw') {
      const { amount } = body;
      if (!amount || amount <= 0) return Response.json({ error: 'Invalid amount' }, { status: 400 });

      const { data: wallet } = await supabase.from('wallet').select('balance').eq('id', 1).single();
      const currentBalance = wallet?.balance ?? 0;

      if (currentBalance < amount) {
        return Response.json({ error: 'Insufficient funds for withdrawal' }, { status: 400 });
      }

      const newBalance = currentBalance - amount;
      await Promise.all([
        supabase.from('wallet').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('id', 1),
        supabase.from('ledger').insert({ type: 'DEBIT', amount, description: 'Cash Withdrawal' }),
      ]);
      return Response.json({ success: true, balance: newBalance });
    }

    // 2. Action: Open Trade (Manual)
    if (action === 'open') {
      const { symbol, short_name, buy_price, quantity = 1 } = body;
      const tradeValue = buy_price * quantity;
      const charges = calculateCharges(tradeValue, 'buy');
      const totalCost = tradeValue + charges;

      const { data: wallet } = await supabase.from('wallet').select('balance').eq('id', 1).single();
      const currentBalance = wallet?.balance ?? 0;

      if (currentBalance < totalCost) {
        return Response.json({ error: `Need ₹${totalCost.toFixed(2)} (including ₹${charges} charges). Balance: ₹${currentBalance.toFixed(2)}` }, { status: 400 });
      }

      await Promise.all([
        supabase.from('trades').insert({
          symbol,
          short_name: short_name ?? symbol,
          buy_price,
          quantity,
          charges,
          status: 'OPEN',
        }),
        supabase.from('wallet').update({
          balance: currentBalance - totalCost,
          updated_at: new Date().toISOString(),
        }).eq('id', 1),
      ]);

      return Response.json({ success: true, charges });
    }

    // 3. Action: Close Trade (Manual)
    if (action === 'close') {
      const { trade_id, sell_price } = body;
      const { data: trade } = await supabase.from('trades').select('*').eq('id', trade_id).single();
      if (!trade || trade.status === 'CLOSED') return Response.json({ error: 'Trade invalid' }, { status: 400 });

      const sellValue = sell_price * trade.quantity;
      const sellCharges = calculateCharges(sellValue, 'sell');
      const proceeds = sellValue - sellCharges;
      const totalCharges = Number(trade.charges) + sellCharges;
      const profit_loss = proceeds - (trade.buy_price * trade.quantity);

      const { data: wallet } = await supabase.from('wallet').select('balance').eq('id', 1).single();

      await Promise.all([
        supabase.from('trades').update({
          sell_price,
          status: 'CLOSED',
          charges: totalCharges,
          profit_loss,
          closed_at: new Date().toISOString(),
        }).eq('id', trade_id),
        supabase.from('wallet').update({
          balance: (wallet?.balance ?? 0) + proceeds,
          updated_at: new Date().toISOString(),
        }).eq('id', 1),
      ]);

      return Response.json({ success: true, profit_loss, sellCharges });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Wallet operation failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
