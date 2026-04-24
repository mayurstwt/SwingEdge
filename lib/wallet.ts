import { supabase } from "./supabase";
import { Trade, TradeDirection } from "./trading/types";

// ================================
// 💰 GET WALLET
// ================================
export async function getWallet() {
  const { data, error } = await supabase
    .from("wallet")
    .select("*")
    .single();

  if (error) {
    console.error("Wallet fetch error:", error);
    return null;
  }

  return data;
}

// ================================
// 💳 UPDATE WALLET
// ================================
export async function updateWallet({
  balance,
}: {
  balance: number;
}) {
  const { error } = await supabase
    .from("wallet")
    .update({
      balance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("Wallet update error:", error);
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
) {
  if (direction === "LONG") {
    return (exitPrice - entryPrice) * quantity;
  }

  if (direction === "SHORT") {
    return (entryPrice - exitPrice) * quantity;
  }

  return 0;
}

// ================================
// 🔁 CLOSE TRADE
// ================================
export async function closeTrade(
  tradeId: string,
  exitPrice: number
) {
  // 1. Fetch trade
  const { data: trade, error } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .single();

  if (error || !trade) {
    console.error("Trade not found:", error);
    return;
  }

  // 2. Calculate PnL
  const pnl = calculatePnL(
    trade.direction,
    trade.entry_price,
    exitPrice,
    trade.quantity
  );

  // 3. Update trade
  await supabase
    .from("trades")
    .update({
      exit_price: exitPrice,
      pnl,
      status: "CLOSED",
      closed_at: new Date().toISOString(),
    })
    .eq("id", tradeId);

  // 4. Update wallet
  const wallet = await getWallet();

  if (!wallet) return;

  const newBalance = wallet.balance + pnl;

  await updateWallet({
    balance: newBalance,
  });
}

// ================================
// 🔍 CHECK EXIT CONDITIONS
// ================================
export async function checkAndCloseTrades() {
  const { data: openTrades } = await supabase
    .from("trades")
    .select("*")
    .eq("status", "OPEN");

  if (!openTrades) return;

  for (const trade of openTrades) {
    const currentPrice = trade.entry_price; // ⚠️ replace with live price if needed

    // LONG EXIT
    if (trade.direction === "LONG") {
      if (currentPrice <= trade.stop_loss) {
        await closeTrade(trade.id, currentPrice);
      }

      if (currentPrice >= trade.target) {
        await closeTrade(trade.id, currentPrice);
      }
    }

    // SHORT EXIT
    if (trade.direction === "SHORT") {
      if (currentPrice >= trade.stop_loss) {
        await closeTrade(trade.id, currentPrice);
      }

      if (currentPrice <= trade.target) {
        await closeTrade(trade.id, currentPrice);
      }
    }
  }
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
  const stt = type === "sell" ? tradeValue * 0.001 : 0; // STT on sell
  const transactionCharges = tradeValue * 0.0000325;
  const gst = (brokerage + transactionCharges) * 0.18;

  const totalCharges = brokerage + stt + transactionCharges + gst;

  return Number(totalCharges.toFixed(2));
}