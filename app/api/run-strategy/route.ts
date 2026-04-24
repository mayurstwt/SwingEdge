import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketData } from "@/lib/trading/market-data";
import { calculatePositionSize } from "@/lib/trading/risk";
import { getWallet, updateWallet, calculatePnL } from "@/lib/wallet";
import { supabase } from "@/lib/supabase";
import { TradeDirection } from "@/lib/trading/types";

const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.9;
const MIN_CONFIDENCE = 60; // 🔥 only take strong trades
const TRADE_COOLDOWN_HOURS = 6;

export async function GET() {
  try {
    const logs: string[] = [];

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
    // 🔁 CLOSE TRADES FIRST
    // ================================
    if (openTrades?.length) {
      for (const trade of openTrades) {
        const marketData = await getMarketData(trade.symbol);
        if (!marketData?.length) continue;

        const currentPrice = marketData[marketData.length - 1];

        let shouldClose = false;

        if (trade.direction === "LONG") {
          if (currentPrice <= trade.stop_loss) shouldClose = true;
          if (currentPrice >= trade.target) shouldClose = true;
        }

        if (trade.direction === "SHORT") {
          if (currentPrice >= trade.stop_loss) shouldClose = true;
          if (currentPrice <= trade.target) shouldClose = true;
        }

        if (shouldClose) {
          const pnl = calculatePnL(
            trade.direction,
            trade.entry_price,
            currentPrice,
            trade.quantity
          );

          await supabase
            .from("trades")
            .update({
              exit_price: currentPrice,
              pnl,
              status: "CLOSED",
              closed_at: new Date().toISOString(),
            })
            .eq("id", trade.id);

          availableCapital += pnl;

          await updateWallet({ balance: availableCapital });

          logs.push(`${trade.symbol}: closed (PnL: ${pnl.toFixed(2)})`);
        }
      }
    }

    // ================================
    // 🚫 LIMIT CHECK
    // ================================
    if (openTrades && openTrades.length >= MAX_OPEN_TRADES) {
      logs.push("Max open trades reached");
      return NextResponse.json({ logs });
    }

    // ================================
    // 📊 STOCK LIST
    // ================================
    const { data: stocks } = await supabase.from("signals").select("symbol");
    if (!stocks) return NextResponse.json({ error: "No stocks found" });

    // ================================
    // 🔁 NEW TRADES
    // ================================
    for (const stock of stocks) {
      const symbol = stock.symbol;

      // ❌ Skip if already open
      if (openTrades?.some(t => t.symbol === symbol)) {
        logs.push(`${symbol}: already open`);
        continue;
      }

      // ❌ Cooldown check
      const { data: lastTrade } = await supabase
        .from("trades")
        .select("created_at")
        .eq("symbol", symbol)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (lastTrade) {
        const lastTime = new Date(lastTrade.created_at).getTime();
        const now = Date.now();

        const hoursDiff = (now - lastTime) / (1000 * 60 * 60);

        if (hoursDiff < TRADE_COOLDOWN_HOURS) {
          logs.push(`${symbol}: cooldown active`);
          continue;
        }
      }

      const marketData = await getMarketData(symbol);
      if (!marketData || marketData.length < 50) {
        logs.push(`${symbol}: insufficient data`);
        continue;
      }

      const analysis = analyzeStock(marketData);

      // ❌ Skip weak trades
      if (
        analysis.decision === "AVOID" ||
        analysis.decision === "HOLD" ||
        analysis.confidence < MIN_CONFIDENCE
      ) {
        logs.push(`${symbol}: weak signal`);
        continue;
      }

      // ================================
      // 💰 POSITION SIZE (FIXED)
      // ================================
      const sizing = calculatePositionSize({
        price: analysis.entry,
        stopLoss: analysis.stopLoss,
        currentEquity: wallet.balance,
        availableCash: availableCapital,
        riskTier: "NORMAL",
        strategyWeight: 1,
        capitalLimitPct: MAX_CAPITAL_USAGE,
      });

      if (sizing.quantity <= 0) {
        logs.push(`${symbol}: size rejected`);
        continue;
      }

      const direction: TradeDirection =
        analysis.decision === "BUY" ? "LONG" : "SHORT";

      const { error } = await supabase.from("trades").insert({
        symbol,
        direction,
        entry_price: analysis.entry,
        stop_loss: analysis.stopLoss,
        target: analysis.target,
        quantity: sizing.quantity,
        status: "OPEN",
      });

      if (error) {
        logs.push(`${symbol}: insert failed`);
        continue;
      }

      const capitalUsed = analysis.entry * sizing.quantity;
      availableCapital -= capitalUsed;

      await updateWallet({ balance: availableCapital });

      logs.push(`${symbol}: ${direction} opened`);
    }

    return NextResponse.json({ logs });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Strategy failed" }, { status: 500 });
  }
}