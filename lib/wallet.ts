import { getSupabaseAdmin, TradeRow } from './supabase';
import { STRATEGY_VERSION } from './strategy';
import type {
  EntryType,
  MarketCondition,
  RiskTier,
  VolumeStrength,
} from '@/lib/trading/types';

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

/**
 * 🔥 SAFE WALLET FETCH (fixes your error)
 */
async function getWalletBalance() {
  // Must use admin client — wallet table has RLS enabled
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('wallet')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('Wallet fetch error:', error);
  }

  return Number(data?.balance ?? 50000);
}

/**
 * 🔥 SAFE WALLET UPDATE
 */
async function updateWalletBalance(newBalance: number) {
  // Must use admin client — wallet table has RLS enabled
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('wallet')
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  if (error) {
    console.error('Wallet update error:', error);
  }
}

export async function executeAutoBuy(
  symbol: string,
  shortName: string,
  price: number,
  stopLoss: number,
  target: number,
  reason: string,
  sector: string,
  options?: {
    quantity?: number;
    entryType?: EntryType;
    marketCondition?: MarketCondition;
    volumeStrength?: VolumeStrength;
    riskReward?: number | null;
    strategyWeight?: number;
    riskTier?: RiskTier;
    entryScore?: number;
  }
) {
  // Must use admin client — trades table has RLS enabled
  const supabase = getSupabaseAdmin();

  const balance = await getWalletBalance();

  const riskPerShare = Math.abs(price - stopLoss);
  let quantity = options?.quantity ?? 0;

  // 🔥 Position sizing fallback
  if (quantity <= 0) {
    if (riskPerShare <= 0) {
      console.log(`❌ ${symbol}: Invalid SL distance`);
      return { success: false, reason: 'Invalid SL distance' };
    }

    const riskAmount = balance * 0.01;
    quantity = Math.floor(riskAmount / riskPerShare);
  }

  const maxAffordableQty = Math.floor(balance / price);
  quantity = Math.min(quantity, maxAffordableQty);

  if (quantity <= 0) {
    console.log(`❌ ${symbol}: Position size too small`);
    return { success: false, reason: 'Position size too small' };
  }

  const tradeValue = price * quantity;
  const charges = calculateCharges(tradeValue, 'buy');
  const totalCost = tradeValue + charges;

  if (balance < totalCost) {
    console.log(`❌ ${symbol}: Insufficient funds`);
    return { success: false, reason: 'Insufficient funds' };
  }

  const riskReward =
    options?.riskReward ??
    (target && stopLoss
      ? Number(((target - price) / (price - stopLoss)).toFixed(2))
      : null);

  const volume_strength = options?.volumeStrength ?? 'NORMAL';
  const entry_type = options?.entryType ?? 'MOMENTUM';
  const market_condition = options?.marketCondition ?? 'NEUTRAL';

  console.log(`🚀 BUY EXECUTING: ${symbol} qty=${quantity} price=${price}`);

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

    entry_type,
    market_condition,
    volume_strength,
    risk_reward: riskReward,
    strategy_weight: options?.strategyWeight ?? 1,
    risk_tier: options?.riskTier ?? 'NORMAL',
    partial_exit_count: 0,
    initial_stop_loss: stopLoss,
    highest_price: price,
    entry_score: options?.entryScore ?? null,
  });

  if (error) {
    console.error(`❌ ${symbol}: Trade insert failed`, error);
    return { success: false, reason: error.message };
  }

  await updateWalletBalance(balance - totalCost);

  return { success: true, quantity, cost: totalCost };
}

export async function executeAutoSell(
  trade: TradeRow,
  currentPrice: number,
  reason: string,
  options?: {
    quantity?: number;
    partial?: boolean;
  }
) {
  // Must use admin client — trades table has RLS enabled
  const supabase = getSupabaseAdmin();

  const sellQuantity = Math.max(
    1,
    Math.min(options?.quantity ?? trade.quantity, trade.quantity)
  );

  const sellValue = currentPrice * sellQuantity;
  const sellCharges = calculateCharges(sellValue, 'sell');
  const proceeds = sellValue - sellCharges;

  const totalCharges = Number(trade.charges) + sellCharges;

  const profit_loss =
    proceeds - trade.buy_price * sellQuantity;

  const balance = await getWalletBalance();

  const partial = options?.partial === true && sellQuantity < trade.quantity;

  const tradeUpdate = partial
    ? {
        quantity: trade.quantity - sellQuantity,
        charges: totalCharges,
        profit_loss: Number((Number(trade.profit_loss ?? 0) + profit_loss).toFixed(2)),
        partial_exit_count: (trade.partial_exit_count ?? 0) + 1,
        target: null,
        highest_price: Math.max(Number(trade.highest_price ?? trade.buy_price), currentPrice),
        reason: `${trade.reason ?? ''} | Partial Exit: ${reason}`.trim(),
      }
    : {
        sell_price: Number(currentPrice.toFixed(2)),
        status: 'CLOSED',
        charges: totalCharges,
        profit_loss: Number((Number(trade.profit_loss ?? 0) + profit_loss).toFixed(2)),
        closed_at: new Date().toISOString(),
        highest_price: Math.max(Number(trade.highest_price ?? trade.buy_price), currentPrice),
        reason: `${trade.reason ?? ''} | Exit: ${reason}`.trim(),
      };

  await Promise.all([
    supabase.from('trades').update(tradeUpdate).eq('id', trade.id),
    updateWalletBalance(balance + proceeds),
  ]);

  console.log(`💰 SELL EXECUTED: ${trade.symbol} qty=${sellQuantity}`);

  return { success: true, pnl: profit_loss, reason, partial, proceeds };
}