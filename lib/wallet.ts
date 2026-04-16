import { getSupabase, TradeRow } from './supabase';
import { STRATEGY_VERSION } from './strategy';

/**
 * Realistic Indian Brokerage Calculation + Slippage simulation
 */
export function calculateCharges(amount: number, type: 'buy' | 'sell'): number {
  const stt = amount * 0.001; 
  const brokerage = Math.min(20, amount * 0.0005); 
  const flatFees = type === 'sell' ? 18.8 : 0; 
  const regulatory = amount * 0.0002; 
  const slippage = amount * 0.0005;

  return Number((stt + brokerage + flatFees + regulatory + slippage).toFixed(2));
}

export async function executeAutoBuy(
  symbol: string, 
  shortName: string, 
  price: number, 
  stopLoss: number,
  target: number,
  reason: string,
  sector: string,
  budget: number = 10000
) {
  const supabase = getSupabase();

  const { data: wallet } = await supabase
    .from('wallet')
    .select('balance')
    .eq('id', 1)
    .single();

  const balance = wallet?.balance ?? 0;

  // 🔥 RISK BASED POSITION SIZING
  const RISK_PERCENT = 0.01;
  const riskAmount = balance * RISK_PERCENT;

  const riskPerShare = Math.abs(price - stopLoss);

  if (riskPerShare <= 0) {
    return { success: false, reason: 'Invalid SL distance' };
  }

  let quantity = Math.floor(riskAmount / riskPerShare);

  const maxAffordableQty = Math.floor(balance / price);
  quantity = Math.min(quantity, maxAffordableQty);

  if (quantity <= 0) {
    return { success: false, reason: 'Position size too small' };
  }

  // 🔥 NEW: STRATEGY INTELLIGENCE METADATA

  const riskReward =
    target && stopLoss
      ? Number(((target - price) / (price - stopLoss)).toFixed(2))
      : null;

  const volume_strength =
    reason?.toLowerCase().includes('volume')
      ? 'HIGH'
      : 'NORMAL';

  const entry_type =
    reason?.toLowerCase().includes('breakout')
      ? 'BREAKOUT'
      : reason?.toLowerCase().includes('pullback')
      ? 'PULLBACK'
      : 'MOMENTUM';

  const market_condition =
    reason?.toLowerCase().includes('uptrend')
      ? 'BULLISH'
      : 'NEUTRAL';

  // 🔥 EXECUTION

  const tradeValue = price * quantity;
  const charges = calculateCharges(tradeValue, 'buy');
  const totalCost = tradeValue + charges;

  if (balance < totalCost) {
    return { success: false, reason: 'Insufficient funds' };
  }

  const { error } = await supabase.from('trades').insert({
    symbol,
    short_name: shortName,
    buy_price: Number(price.toFixed(2)),
    quantity,
    charges,
    stop_loss: stopLoss,
    target: target,
    reason,
    strategy_version: STRATEGY_VERSION,
    sector,
    status: 'OPEN',
    executed_by: 'AUTO',

    // 🔥 NEW INTELLIGENCE FIELDS
    entry_type,
    market_condition,
    volume_strength,
    risk_reward: riskReward,
  });

  if (error) {
    return { success: false, reason: error.message };
  }

  await supabase
    .from('wallet')
    .update({
      balance: balance - totalCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  return { success: true, quantity, cost: totalCost };
}

export async function executeAutoSell(
  trade: TradeRow,
  currentPrice: number,
  reason: string
) {
  const supabase = getSupabase();

  const sellValue = currentPrice * trade.quantity;
  const sellCharges = calculateCharges(sellValue, 'sell');
  const proceeds = sellValue - sellCharges;

  const totalCharges = Number(trade.charges) + sellCharges;

  const profit_loss =
    proceeds - (trade.buy_price * trade.quantity);

  const { data: wallet } = await supabase
    .from('wallet')
    .select('balance')
    .eq('id', 1)
    .single();

  await Promise.all([
    supabase.from('trades').update({
      sell_price: Number(currentPrice.toFixed(2)),
      status: 'CLOSED',
      charges: totalCharges,
      profit_loss,
      closed_at: new Date().toISOString(),

      // 🔥 KEEP ORIGINAL + APPEND EXIT REASON
      reason: `${trade.reason} | Exit: ${reason}`,

    }).eq('id', trade.id),

    supabase.from('wallet').update({
      balance: (wallet?.balance ?? 0) + proceeds,
      updated_at: new Date().toISOString(),
    }).eq('id', 1),
  ]);

  return { success: true, pnl: profit_loss, reason };
}