import { getSupabaseAdmin } from "./supabase";
import { getMarketDataFull } from "./trading/market-data";
import type { TradeDirection } from "./trading/types";

// ================================
// 💰 GET WALLET
// ================================
export async function getWallet() {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("wallet")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    console.error("Wallet fetch error:", error);
    return null;
  }

  return data as { id: number; balance: number; updated_at: string };
}

// ================================
// 💳 UPDATE WALLET
// ================================
export async function updateWallet({
  balance,
}: {
  balance: number;
}) {
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase
    .from("wallet")
    .update({
      balance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("Wallet update error:", error);
    throw new Error(`Wallet update failed: ${error.message}`);
  }
}

// ================================
// 📊 CALCULATE PnL
// ================================
export function calculatePnL(
  direction: TradeDirection,
  entryPrice: number,
  exitPrice: number,
  quantity: number
): number {
  if (direction === "LONG") {
    return (exitPrice - entryPrice) * quantity;
  }

  if (direction === "SHORT") {
    return (entryPrice - exitPrice) * quantity;
  }

  return 0;
}

// ================================
// 💸 CALCULATE CHARGES (BROKERAGE SIMULATION)
// ================================
export function calculateCharges(
  tradeValue: number,
  type: "buy" | "sell"
): number {
  // Basic Indian brokerage approximation
  const brokerage = Math.min(20, tradeValue * 0.0003); // 0.03% or ₹20 max
  const stt = type === "sell" ? tradeValue * 0.001 : 0; // STT on sell only
  const transactionCharges = tradeValue * 0.0000325;
  const gst = (brokerage + transactionCharges) * 0.18;

  const totalCharges = brokerage + stt + transactionCharges + gst;

  return Number(totalCharges.toFixed(2));
}

// ================================
// 🔁 CLOSE TRADE (with live price)
// ================================
export async function closeTrade(
  tradeId: string,
  exitPrice: number,
  reason: string = "manual"
) {
  const supabase = getSupabaseAdmin();
  
  // 1. Fetch trade
  const { data: trade, error } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .single();

  if (error || !trade) {
    console.error("Trade not found:", error);
    throw new Error("Trade not found");
  }

  if (trade.status === "CLOSED") {
    throw new Error("Trade already closed");
  }

  // 2. Calculate PnL
  const rawPnl = calculatePnL(
    (trade.direction as TradeDirection) || "LONG",
    trade.entry_price,
    exitPrice,
    trade.quantity
  );

  // 3. Calculate sell charges
  const sellValue = exitPrice * trade.quantity;
  const sellCharges = calculateCharges(sellValue, "sell");
  const totalCharges = Number(trade.charges || 0) + sellCharges;

  // 4. Net PnL after charges
  const netPnL = rawPnl - sellCharges;

  // 5. Update trade with BOTH pnl and profit_loss for compatibility
  const { error: updateError } = await supabase
    .from("trades")
    .update({
      exit_price: exitPrice,
      sell_price: exitPrice,
      pnl: netPnL,
      profit_loss: netPnL,
      charges: totalCharges,
      status: "CLOSED",
      closed_at: new Date().toISOString(),
      reason: trade.reason ? `${trade.reason}, ${reason}` : reason,
    })
    .eq("id", tradeId);

  if (updateError) {
    console.error("Trade close error:", updateError);
    throw new Error(`Failed to close trade: ${updateError.message}`);
  }

  // 6. Update wallet with proceeds
  const wallet = await getWallet();
  if (!wallet) {
    throw new Error("Wallet not found");
  }

  // Add back: sell proceeds minus charges
  const proceeds = sellValue - sellCharges;
  const newBalance = wallet.balance + proceeds;

  await updateWallet({ balance: newBalance });

  // 7. Add ledger entry for transparency
  await supabase.from("ledger").insert({
    type: netPnL >= 0 ? "CREDIT" : "DEBIT",
    amount: Math.abs(netPnL),
    description: `Trade ${netPnL >= 0 ? "profit" : "loss"}: ${trade.symbol} (${reason})`,
  });

  return {
    tradeId,
    symbol: trade.symbol,
    rawPnl,
    netPnL,
    sellCharges,
    totalCharges,
    newBalance,
  };
}