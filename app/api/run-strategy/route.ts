import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketData } from "@/lib/trading/market-data";
import { calculatePositionSize } from "@/lib/trading/risk";
import {
  getWallet,
  updateWallet,
  calculatePnL,
} from "@/lib/wallet";
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
    // 📂 LOAD OPEN TRADES
    // ================================
    const { data: openTrades } = await supabase
      .from("trades")
      .select("*")
      .eq("status", "OPEN");

    // ================================
    // 🔁 CLOSE EXISTING TRADES FIRST
    // ================================
    if (openTrades && openTrades.length > 0) {
      for (const trade of openTrades) {
        const marketData = await getMarketData(trade.symbol);
        if (!marketData || marketData.length === 0) continue;

        const currentPrice = marketData[marketData.length - 1];

        let shouldClose = false;

        // LONG EXIT
        if (trade.direction === "LONG") {
          if (currentPrice <= trade.stop_loss) {
            logs.push(`${trade.symbol}: LONG stop loss hit`);
            shouldClose = true;
          }

          if (currentPrice >= trade.target) {
            logs.push(`${trade.symbol}: LONG target hit`);
            shouldClose = true;
          }
        }

        // SHORT EXIT
        if (trade.direction === "SHORT") {
          if (currentPrice >= trade.stop_loss) {
            logs.push(`${trade.symbol}: SHORT stop loss hit`);
            shouldClose = true;
          }

          if (currentPrice <= trade.target) {
            logs.push(`${trade.symbol}: SHORT target hit`);
            shouldClose = true;
          }
        }

        if (shouldClose) {
          const pnl = calculatePnL(
            trade.direction,
            trade.entry_price,
            currentPrice,
            trade.quantity
          );

          // update trade
          await supabase
            .from("trades")
            .update({
              exit_price: currentPrice,
              pnl,
              status: "CLOSED",
              closed_at: new Date().toISOString(),
            })
            .eq("id", trade.id);

          // update wallet
          availableCapital += pnl;

          await updateWallet({
            balance: availableCapital,
          });
        }
      }
    }

    // ================================
    // 🚫 CHECK OPEN TRADES LIMIT
    // ================================
    if (openTrades && openTrades.length >= MAX_OPEN_TRADES) {
      logs.push("Max open trades reached");
      return NextResponse.json({ logs });
    }

    // ================================
    // 📊 LOAD STOCK LIST
    // ================================
    const { data: stocks } = await supabase.from("signals").select("symbol");

    if (!stocks) {
      return NextResponse.json({ error: "No stocks found" });
    }

    // ================================
    // 🔁 PROCESS NEW TRADES
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
        logs.push(`${symbol}: capital limit reached`);
        continue;
      }

      // ================================
      // 📐 POSITION SIZE
      // ================================
      const quantity = calculatePositionSize({
        balance: availableCapital,
        entry: analysis.entry,
        stopLoss: analysis.stopLoss,
      });

      if (!quantity || quantity <= 0) {
        logs.push(`${symbol}: invalid size`);
        continue;
      }

      // ================================
      // 📉 TRADE TYPE
      // ================================
      const direction: TradeDirection =
        analysis