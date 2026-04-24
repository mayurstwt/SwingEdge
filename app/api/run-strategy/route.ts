import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketDataFull } from "@/lib/trading/market-data";
import { calculatePositionSize } from "@/lib/trading/risk";
import { getWallet, updateWallet, calculatePnL } from "@/lib/wallet";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TradeDirection } from "@/lib/trading/types";

const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.9;
const MIN_CONFIDENCE = 60;
const TRADE_COOLDOWN_HOURS = 6;

// Handle both GET (cron) and POST (manual/dashboard) requests
export async function GET() {
  return runStrategy();
}

export async function POST() {
  return runStrategy();
}

async function runStrategy() {
  const logs: string[] = [];
  const supabase = getSupabaseAdmin();

  try {
    const wallet = await getWallet();
    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 400 });
    }

    let availableCapital = wallet.balance;

    // ================================
    // 📂 LOAD OPEN TRADES
    // ================================
    const { data: openTrades, error: openTradesError } = await supabase
      .from("trades")
      .select("*")
      .eq("status", "OPEN");

    if (openTradesError) {
      console.error("Open trades fetch error:", openTradesError);
      return NextResponse.json({ error: "Failed to load open trades" }, { status: 500 });
    }

    // ================================
    // 🔁 MANAGE OPEN TRADES (Trailing Stop & Target)
    // ================================
    if (openTrades?.length) {
      for (const trade of openTrades) {
        const { closes, highs, lows } = await getMarketDataFull(trade.symbol, {
          range: '1mo',
          interval: '1d',
        });

        if (!closes.length) {
          logs.push(`${trade.symbol}: no market data for exit check`);
          continue;
        }

        const currentPrice = closes[closes.length - 1];
        const currentHigh = highs[highs.length - 1];
        
        // Update highest price if applicable (for trailing stop)
        if (trade.direction === "LONG" && currentHigh > (trade.highest_price ?? 0)) {
          await supabase
            .from("trades")
            .update({ highest_price: currentHigh })
            .eq("id", trade.id);
        }

        let shouldClose = false;
        let closeReason = "";

        if (trade.direction === "LONG") {
          // Check target first
          if (currentPrice >= trade.target) {
            shouldClose = true;
            closeReason = "target hit";
          }
          // Check trailing stop: 1.5x ATR from highest price since entry
          else if (trade.highest_price && trade.initial_stop_loss) {
            const atr = trade.target - trade.entry_price; // approximate from setup
            const trailingStop = (trade.highest_price as number) - (1.5 * atr / 2.2); // reverse from target calc
            if (currentPrice <= trailingStop) {
              shouldClose = true;
              closeReason = "trailing stop";
            }
          }
          // Check initial stop loss
          else if (currentPrice <= trade.stop_loss) {
            shouldClose = true;
            closeReason = "stop loss";
          }
        }

        // SHORT trades (if you add them later)
        if (trade.direction === "SHORT") {
          if (currentPrice <= trade.target) {
            shouldClose = true;
            closeReason = "target hit";
          } else if (currentPrice >= trade.stop_loss) {
            shouldClose = true;
            closeReason = "stop loss";
          }
        }

        if (shouldClose) {
          const pnl = calculatePnL(
            trade.direction as TradeDirection,
            trade.entry_price,
            currentPrice,
            trade.quantity
          );

          const sellCharges = calculateSellCharges(currentPrice * trade.quantity);
          const netPnL = pnl - sellCharges;

          await supabase
            .from("trades")
            .update({
              exit_price: currentPrice,
              sell_price: currentPrice,
              pnl: netPnL,
              profit_loss: netPnL,
              status: "CLOSED",
              closed_at: new Date().toISOString(),
            })
            .eq("id", trade.id);

          availableCapital += (currentPrice * trade.quantity) - sellCharges;

          await updateWallet({ balance: availableCapital });

          logs.push(`${trade.symbol}: closed at ₹${currentPrice} (${closeReason}, PnL: ₹${netPnL.toFixed(2)})`);
        }
      }
    }

    // ================================
    // 🚫 LIMIT CHECKS
    // ================================
    const activeOpenTrades = openTrades?.filter(t => t.status === "OPEN") ?? [];
    
    if (activeOpenTrades.length >= MAX_OPEN_TRADES) {
      logs.push("Max open trades reached");
      return NextResponse.json({ logs, openTrades: activeOpenTrades.length });
    }

    const investedCapital = activeOpenTrades.reduce(
      (sum, t) => sum + (t.entry_price * t.quantity), 0
    );
    
    if (investedCapital >= wallet.balance * MAX_CAPITAL_USAGE) {
      logs.push("Capital usage exceeds limit");
      return NextResponse.json({ logs, investedCapital, maxAllowed: wallet.balance * MAX_CAPITAL_USAGE });
    }

    // ================================
    // 📊 GET STOCK UNIVERSE
    // ================================
    // Use stocks.json as universe, or signals table if populated
    const { data: stocksData } = await supabase
      .from("signals")
      .select("symbol, short_name, sector")
      .order("score", { ascending: false });

    // Fallback to stocks.json if no signals in DB
    let stocks: Array<{ symbol: string; short_name?: string; sector?: string }> = [];
    
    if (stocksData && stocksData.length > 0) {
      stocks = stocksData;
    } else {
      const allStocks = (await import("@/data/stocks.json")).default;
      stocks = allStocks.slice(0, 20); // Analyze top 20 if no prior signals
    }

    if (!stocks.length) {
      return NextResponse.json({ error: "No stocks found to analyze" }, { status: 400 });
    }

    // ================================
    // 🔁 NIFTY MARKET FILTER
    // ================================
    let marketBullish = true;
    try {
      const niftyData = await getMarketDataFull('^NSEI', { range: '3mo', interval: '1d' });
      if (niftyData.closes.length >= 30) {
        const niftyAnalysis = analyzeStock(niftyData.closes, niftyData.highs, niftyData.lows, niftyData.volumes);
        marketBullish = niftyAnalysis.trend === 'UPTREND';
        if (!marketBullish) {
          logs.push("Market Bearish filter active");
        }
      }
    } catch (err) {
      console.warn("NIFTY filter failed:", err);
    }

    // ================================
    // 🔁 ANALYZE & OPEN NEW TRADES
    // ================================
    for (const stock of stocks) {
      const symbol = stock.symbol;

      // Skip if already open
      if (activeOpenTrades.some(t => t.symbol === symbol)) {
        logs.push(`${symbol}: already open`);
        continue;
      }

      // Cooldown check
      const { data: lastTrade } = await supabase
        .from("trades")
        .select("opened_at")
        .eq("symbol", symbol)
        .order("opened_at", { ascending: false })
        .limit(1)
        .single();

      if (lastTrade?.opened_at) {
        const lastTime = new Date(lastTrade.opened_at).getTime();
        const hoursDiff = (Date.now() - lastTime) / (1000 * 60 * 60);
        if (hoursDiff < TRADE_COOLDOWN_HOURS) {
          logs.push(`${symbol}: cooldown active (${(TRADE_COOLDOWN_HOURS - hoursDiff).toFixed(1)}h left)`);
          continue;
        }
      }

      // Fetch market data
      const { closes, highs, lows, volumes } = await getMarketDataFull(symbol, {
        range: '1y',
        interval: '1d',
      });

      if (!closes || closes.length < 50) {
        logs.push(`${symbol}: insufficient data (${closes?.length ?? 0} bars)`);
        continue;
      }

      const analysis = analyzeStock(closes, highs, lows, volumes);

      // Apply market filter penalty
      if (!marketBullish) {
        analysis.score = Math.max(0, analysis.score - 10);
        analysis.signals.push("Score adjusted -10 (bear market)");
        
        if (analysis.score >= 70) analysis.decision = 'BUY';
        else if (analysis.score >= 50) analysis.decision = 'HOLD';
        else analysis.decision = 'AVOID';
      }

      // Skip weak signals
      if (analysis.decision !== "BUY" || analysis.confidence < MIN_CONFIDENCE) {
        logs.push(`${symbol}: ${analysis.decision} (score: ${analysis.score}, confidence: ${analysis.confidence}%)`);
        continue;
      }

      // ================================
      // 💰 POSITION SIZING
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
        logs.push(`${symbol}: sizing rejected (risk: ₹${sizing.riskPerShare}, max: ₹${(wallet.balance * MAX_CAPITAL_USAGE).toFixed(0)})`);
        continue;
      }

      // Check capital limit
      const tradeValue = analysis.entry * sizing.quantity;
      const buyCharges = calculateBuyCharges(tradeValue);
      const totalCost = tradeValue + buyCharges;

      if (totalCost > availableCapital) {
        logs.push(`${symbol}: insufficient capital (need ₹${totalCost.toFixed(0)}, have ₹${availableCapital.toFixed(0)})`);
        continue;
      }

      // ================================
      // 📝 INSERT TRADE
      // ================================
      const direction: TradeDirection = "LONG";
      
      const { error: insertError } = await supabase.from("trades").insert({
        symbol,
        short_name: stock.short_name ?? symbol.replace('.NS', ''),
        sector: stock.sector ?? 'UNKNOWN',
        direction,
        entry_price: analysis.entry,
        buy_price: analysis.entry,
        stop_loss: analysis.stopLoss,
        target: analysis.target,
        initial_stop_loss: analysis.stopLoss,
        highest_price: analysis.entry, // Will update as price rises
        quantity: sizing.quantity,
        charges: buyCharges,
        status: "OPEN",
        executed_by: "AUTO",
        entry_type: "MARKET",
        market_condition: marketBullish ? "BULL" : "BEAR",
        volume_strength: analysis.volumeRatio && analysis.volumeRatio > 1.2 ? "STRONG" : "NORMAL",
        risk_reward: analysis.riskReward,
        strategy_weight: 1,
        risk_tier: "NORMAL",
        entry_score: analysis.score,
        pnl: 0,
        profit_loss: 0,
        opened_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error(`Insert failed for ${symbol}:`, insertError);
        logs.push(`${symbol}: DB insert failed`);
        continue;
      }

      // Update wallet
      availableCapital -= totalCost;
      await updateWallet({ balance: availableCapital });

      logs.push(`${symbol}: LONG ${sizing.quantity} shares @ ₹${analysis.entry} (score: ${analysis.score})`);

      // Save signal to DB for reference
      await supabase.from("signals").upsert({
        symbol,
        short_name: stock.short_name ?? symbol.replace('.NS', ''),
        decision: analysis.decision,
        score: analysis.score,
        confidence: analysis.confidence,
        price: analysis.price,
        stop_loss: analysis.stopLoss,
        target: analysis.target,
        rsi: analysis.rsi,
        trend: analysis.trend,
        change_pct: analysis.changePercent,
        run_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'symbol,run_date' });
    }

    return NextResponse.json({ 
      logs, 
      openTrades: activeOpenTrades.length,
      availableCapital,
      totalCapital: wallet.balance 
    });

  } catch (err) {
    console.error("Strategy error:", err);
    return NextResponse.json({ error: "Strategy failed", logs }, { status: 500 });
  }
}

// ================================
// 💸 CHARGE CALCULATIONS
// ================================
function calculateBuyCharges(tradeValue: number): number {
  const brokerage = Math.min(20, tradeValue * 0.0003);
  const transactionCharges = tradeValue * 0.0000325;
  const gst = (brokerage + transactionCharges) * 0.18;
  return Number((brokerage + transactionCharges + gst).toFixed(2));
}

function calculateSellCharges(tradeValue: number): number {
  const brokerage = Math.min(20, tradeValue * 0.0003);
  const stt = tradeValue * 0.001;
  const transactionCharges = tradeValue * 0.0000325;
  const gst = (brokerage + transactionCharges) * 0.18;
  return Number((brokerage + stt + transactionCharges + gst).toFixed(2));
}