import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketData } from "@/lib/trading/market-data";
import { calculatePositionSize } from "@/lib/trading/risk";
import { getWallet, updateWallet } from "@/lib/wallet";
import { supabase } from "@/lib/supabase";
import { TradeDirection } from "@/lib/trading/types";

const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.9;

export async function GET() {
  try {
    const logs: string[] = [];

    // ================================
    // 💰 LOAD WALLET
    // ================================
    const wallet = await getWallet();

    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 400 });
    }

    let availableCapital = wallet.balance;

    // ================================
    // 📊 LOAD STOCKS
    // ================================
    const { data: stocks } = await supabase.from("signals").select("symbol");

    if (!stocks) {
      return NextResponse.json({ error: "No stocks found" });
    }

    // ================================
    // 📂 LOAD OPEN TRADES
    // ================================
    const { data: openTrades } = await supabase
      .from("trades")
      .select("*")
      .eq("status", "OPEN");

    if (openTrades && openTrades.length >= MAX_OPEN_TRADES) {
      logs.push("Max open trades reached");
      return NextResponse.json({ logs });
    }

    // ================================
    // 🔁 PROCESS EACH STOCK
    // ================================
    for (const stock of stocks) {
      const symbol = stock.symbol;

      const marketData = await getMarketData(symbol);
      if (!marketData || marketData.length < 50) {
        logs.push(`${symbol}: insufficient data`);
        continue;
      }

      const analysis = analyzeStock(marketData);

      if (analysis.decision === "AVOID" || analysis.decision === "HOLD") {
        logs.push(`${symbol}: skipped (${analysis.decision})`);
        continue;
      }

      // ================================
      // 🚫 CAPITAL CHECK
      // ================================
      if (availableCapital <= wallet.balance * (1 - MAX_CAPITAL_USAGE)) {
        logs.push(`${symbol}: capital usage limit reached`);
        continue;
      }

      // ================================
      // 📐 POSITION SIZE
      // ================================
      const quantity = calculatePositionSize({
        balance: wallet.balance,
        entry: analysis.entry,
        stopLoss: analysis.stopLoss,
      });

      if (!quantity || quantity <= 0) {
        logs.push(`${symbol}: invalid position size`);
        continue;
      }

      // ================================
      // 📉 DETERMINE TRADE TYPE
      // ================================
      let direction: TradeDirection =
        analysis.decision === "BUY" ? "LONG" : "SHORT";

      // ================================
      // 💰 CREATE TRADE
      // ================================
      const { error: tradeError } = await supabase.from("trades").insert({
        symbol,
        direction,
        entry_price: analysis.entry,
        stop_loss: analysis.stopLoss,
        target: analysis.target,
        quantity,
        status: "OPEN",
      });

      if (tradeError) {
        logs.push(`${symbol}: trade failed`);
        continue;
      }

      // ================================
      // 💳 UPDATE WALLET
      // ================================
      const capitalUsed = analysis.entry * quantity;

      availableCapital -= capitalUsed;

      await updateWallet({
        balance: availableCapital,
      });

      logs.push(`${symbol}: ${direction} trade opened`);
    }

    return NextResponse.json({ logs });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Strategy failed" }, { status: 500 });
  }
}