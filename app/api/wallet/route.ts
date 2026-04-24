// app/api/wallet/route.ts
import { getSupabaseAdmin } from '@/lib/supabase';
import { calculatePnL, calculateCharges } from '@/lib/wallet';
import type { TradeDirection } from '@/lib/trading/types';

// GET: Return wallet analytics summary
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: trades } = await supabase
      .from('trades')
      .select('profit_loss, status')
      .eq('status', 'CLOSED');

    const closedTrades = trades ?? [];

    if (closedTrades.length === 0) {
      return Response.json({
        winRate: 0,
        totalTrades: 0,
        avgProfit: 0,
        bestTrade: 0,
        worstTrade: 0,
      });
    }

    const profits = closedTrades.map(t => Number(t.profit_loss ?? 0));
    const winningTrades = profits.filter(p => p > 0);

    const winRate = Math.round((winningTrades.length / profits.length) * 100);
    const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const bestTrade = Math.max(...profits);
    const worstTrade = Math.min(...profits);

    return Response.json({
      winRate,
      totalTrades: profits.length,
      avgProfit: Number(avgProfit.toFixed(2)),
      bestTrade: Number(bestTrade.toFixed(2)),
      worstTrade: Number(worstTrade.toFixed(2)),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Analytics failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

// POST: Handle wallet actions (deposit, withdraw, open trade, close trade)
export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action } = body;

    // Fetch current wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallet')
      .select('*')
      .eq('id', 1)
      .single();

    if (walletError || !wallet) {
      return Response.json({ error: 'Wallet not found' }, { status: 400 });
    }

    let newBalance = wallet.balance;

    switch (action) {
      case 'deposit': {
        const amount = Number(body.amount);
        if (!amount || amount <= 0) {
          return Response.json({ error: 'Invalid deposit amount' }, { status: 400 });
        }
        newBalance += amount;

        // Update wallet
        const { error: updateError } = await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);
        if (updateError) throw updateError;

        // Add ledger entry
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
        newBalance -= amount;

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
        // Open a new paper trade
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

        // Calculate stop loss and target (simplified: 2% SL, 4% target)
        const stopLoss = buy_price * 0.98;
        const target = buy_price * 1.04;

        // Insert trade
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

        // Deduct from wallet
        newBalance = wallet.balance - totalCost;
        await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);

        // Ledger entry
        await supabase.from('ledger').insert({
          type: 'DEBIT',
          amount: totalCost,
          description: `Opened ${symbol} x${quantity} @ ₹${buy_price}`,
        });

        return Response.json({ success: true, trade: newTrade, balance: newBalance });
      }

      case 'close': {
        // Close an open trade
        const { trade_id, sell_price } = body;
        if (!trade_id || !sell_price) {
          return Response.json({ error: 'Missing trade_id or sell_price' }, { status: 400 });
        }

        // Fetch the trade
        const { data: trade, error: tradeError } = await supabase
          .from('trades')
          .select('*')
          .eq('id', trade_id)
          .eq('status', 'OPEN')
          .single();

        if (tradeError || !trade) {
          return Response.json({ error: 'Trade not found or already closed' }, { status: 404 });
        }

        // Calculate PnL
        const direction = (trade.direction as TradeDirection) || 'LONG';
        const rawPnl = calculatePnL(direction, trade.buy_price, sell_price, trade.quantity);
        const sellValue = sell_price * trade.quantity;
        const sellCharges = calculateCharges(sellValue, 'sell');
        const netPnl = rawPnl - sellCharges;
        const totalCharges = Number(trade.charges || 0) + sellCharges;

        // Update trade
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

        // Add proceeds back to wallet
        const proceeds = sellValue - sellCharges;
        newBalance = wallet.balance + proceeds;
        await supabase
          .from('wallet')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', 1);

        // Ledger entry
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