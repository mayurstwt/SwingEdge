// app/api/wallet/route.ts
import { getSupabase } from '@/lib/supabase';
import { calculatePnL, calculateCharges } from '@/lib/wallet';
import type { TradeDirection } from '@/lib/trading/types';

export const dynamic = 'force-dynamic';

async function getOrCreateWallet() {
  const supabase = getSupabase();

  const { data: wallet, error } = await supabase
    .from('wallet')
    .select('*')
    .eq('id', 1)
    .single();

  if (wallet) {
    return { supabase, wallet };
  }

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const { data: createdWallet, error: createError } = await supabase
    .from('wallet')
    .upsert({
      id: 1,
      balance: 0,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (createError || !createdWallet) {
    throw createError ?? new Error('Failed to initialize wallet');
  }

  return { supabase, wallet: createdWallet };
}

// GET: Return full wallet state + analytics + trades + ledger + signals
export async function GET() {
  try {
    const { supabase, wallet } = await getOrCreateWallet();

    // 2. Fetch all trades (open + closed)
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .order('opened_at', { ascending: false });

    // 3. Fetch ledger entries
    const { data: ledger } = await supabase
      .from('ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // 4. Fetch recent signals for LTP lookup
    const { data: signals } = await supabase
      .from('signals')
      .select('symbol, price')
      .order('run_date', { ascending: false })
      .limit(100);

    // 5. Calculate analytics from closed trades
    const closedTrades = (trades ?? []).filter(t => t.status === 'CLOSED');
    let analytics = {
      winRate: 0,
      totalTrades: 0,
      avgProfit: 0,
      bestTrade: 0,
      worstTrade: 0,
    };

    if (closedTrades.length > 0) {
      const profits = closedTrades.map(t => Number(t.profit_loss ?? 0));
      const winningTrades = profits.filter(p => p > 0);
      analytics = {
        winRate: Math.round((winningTrades.length / profits.length) * 100),
        totalTrades: profits.length,
        avgProfit: Number((profits.reduce((a, b) => a + b, 0) / profits.length).toFixed(2)),
        bestTrade: Number(Math.max(...profits).toFixed(2)),
        worstTrade: Number(Math.min(...profits).toFixed(2)),
      };
    }

    return Response.json({
      balance: wallet.balance,
      updated_at: wallet.updated_at,
      trades: trades ?? [],
      ledger: ledger ?? [],
      signals: signals ?? [],
      ...analytics,
    });
  } catch (err: unknown) {
    console.error('[wallet GET] Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch wallet';
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST: Handle wallet actions (deposit, withdraw, open trade, close trade)
export async function POST(req: Request) {
  try {
    const { supabase, wallet } = await getOrCreateWallet();
    const body = await req.json();
    const { action } = body;

    let newBalance = wallet.balance;

    switch (action) {
      case 'deposit': {
        const amount = Number(body.amount);
        if (!amount || amount <= 0) {
          return Response.json({ error: 'Invalid deposit amount' }, { status: 400 });
        }
        newBalance = wallet.balance + amount;

        const { error: updateError } = await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);
        if (updateError) throw updateError;

        await supabase.from('ledger').insert({
          type: 'CREDIT',
          amount,
          description: body.description || 'Manual deposit',
        });

        return Response.json({ success: true, balance: newBalance });
      }

      case 'withdraw': {
        const amount = Number(body.amount);
        if (!amount || amount <= 0) {
          return Response.json({ error: 'Invalid withdrawal amount' }, { status: 400 });
        }
        if (amount > wallet.balance) {
          return Response.json({ error: 'Insufficient funds' }, { status: 400 });
        }
        newBalance = wallet.balance - amount;

        const { error: updateError } = await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);
        if (updateError) throw updateError;

        await supabase.from('ledger').insert({
          type: 'DEBIT',
          amount,
          description: body.description || 'Manual withdrawal',
        });

        return Response.json({ success: true, balance: newBalance });
      }

      case 'open': {
        const { symbol, short_name, buy_price, quantity } = body;
        if (!symbol || !buy_price || !quantity) {
          return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const tradeValue = buy_price * quantity;
        const charges = calculateCharges(tradeValue, 'buy');
        const totalCost = tradeValue + charges;

        if (totalCost > wallet.balance) {
          return Response.json({ error: 'Insufficient funds for trade' }, { status: 400 });
        }

        const stopLoss = buy_price * 0.98;
        const target = buy_price * 1.04;

        const { error: tradeError, data: newTrade } = await supabase
          .from('trades')
          .insert({
            symbol,
            short_name: short_name || symbol,
            buy_price,
            quantity,
            charges,
            stop_loss: stopLoss,
            target,
            status: 'OPEN',
            direction: 'LONG' as TradeDirection,
            executed_by: 'MANUAL',
            opened_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (tradeError) throw tradeError;

        newBalance = wallet.balance - totalCost;
        await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);

        await supabase.from('ledger').insert({
          type: 'DEBIT',
          amount: totalCost,
          description: `Opened ${symbol} x${quantity} @ ₹${buy_price}`,
        });

        return Response.json({ success: true, trade: newTrade, balance: newBalance });
      }

      case 'close': {
        const { trade_id, sell_price } = body;
        if (!trade_id || !sell_price) {
          return Response.json({ error: 'Missing trade_id or sell_price' }, { status: 400 });
        }

        const { data: trade, error: tradeError } = await supabase
          .from('trades')
          .select('*')
          .eq('id', trade_id)
          .eq('status', 'OPEN')
          .single();

        if (tradeError || !trade) {
          return Response.json({ error: 'Trade not found or already closed' }, { status: 404 });
        }

        const direction = (trade.direction as TradeDirection) || 'LONG';
        const rawPnl = calculatePnL(direction, trade.buy_price, sell_price, trade.quantity);
        const sellValue = sell_price * trade.quantity;
        const sellCharges = calculateCharges(sellValue, 'sell');
        const netPnl = rawPnl - sellCharges;
        const totalCharges = Number(trade.charges || 0) + sellCharges;

        const { error: updateError } = await supabase
          .from('trades')
          .update({
            sell_price,
            pnl: netPnl,
            profit_loss: netPnl,
            charges: totalCharges,
            status: 'CLOSED',
            closed_at: new Date().toISOString(),
          })
          .eq('id', trade_id);
        if (updateError) throw updateError;

        const proceeds = sellValue - sellCharges;
        newBalance = wallet.balance + proceeds;
        await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);

        await supabase.from('ledger').insert({
          type: netPnl >= 0 ? 'CREDIT' : 'DEBIT',
          amount: Math.abs(netPnl),
          description: `Closed ${trade.symbol}: ${netPnl >= 0 ? 'profit' : 'loss'}`,
        });

        return Response.json({ success: true, pnl: netPnl, balance: newBalance });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    console.error('[wallet POST] Error:', err);
    const message = err instanceof Error ? err.message : 'Wallet action failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
