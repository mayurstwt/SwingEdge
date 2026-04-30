import { NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketDataFull } from "@/lib/trading/market-data";
import { calculatePositionSize } from "@/lib/trading/risk";
import { getWallet, updateWallet, calculatePnL } from "@/lib/wallet";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TradeDirection } from "@/lib/trading/types";
import NIFTY50 from "@/data/stocks.json";

const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.9;
const MIN_SCORE = 70; // BUY threshold
const PARALLEL_BATCH_SIZE = 5; // fetch Yahoo Finance in parallel batches

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

    const activeOpenTrades = openTrades ?? [];

    // ================================
    // 🔁 MANAGE OPEN TRADES (Trailing Stop & Target)
    // ================================
    if (activeOpenTrades.length > 0) {
      for (const trade of activeOpenTrades) {
        const { closes, highs } = await getMarketDataFull(trade.symbol, {
          range: '1mo',
          interval: '1d',
        });

        if (!closes.length) {
          logs.push(`${trade.symbol}: no market data for exit check`);
          continue;
        }

        const currentPrice = closes[closes.length - 1];
        const currentHigh = highs[highs.length - 1];

        // Update highest price for trailing stop
        if (trade.direction === "LONG" && currentHigh > (trade.highest_price ?? 0)) {
          await supabase
            .from("trades")
            .update({ highest_price: currentHigh })
            .eq("id", trade.id);
        }

        let shouldClose = false;
        let closeReason = "";

        if (trade.direction === "LONG") {
          if (currentPrice >= trade.target) {
            shouldClose = true;
            closeReason = "target hit";
          } else if (trade.highest_price && trade.initial_stop_loss) {
            const atr = trade.target - trade.entry_price;
            const trailingStop = (trade.highest_price as number) - (1.5 * atr / 2.2);
            if (currentPrice <= trailingStop) {
              shouldClose = true;
              closeReason = "trailing stop";
            }
          } else if (currentPrice <= trade.stop_loss) {
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

    // Reload open trades after potential closures
    const { data: freshOpenTrades } = await supabase
      .from("trades")
      .select("symbol")
      .eq("status", "OPEN");

    const openSymbols = new Set((freshOpenTrades ?? []).map((t) => t.symbol));
    const openTradeCount = openSymbols.size;

    // ================================
    // 🚫 LIMIT CHECKS
    // ================================
    if (openTradeCount >= MAX_OPEN_TRADES) {
      logs.push(`Max open trades reached (${openTradeCount}/${MAX_OPEN_TRADES})`);
      return NextResponse.json({ logs, openTrades: openTradeCount });
    }

    const { data: freshWallet } = await supabase
      .from("wallet")
      .select("balance")
      .single();
    const currentBalance = freshWallet?.balance ?? wallet.balance;

    // ================================
    // 🔁 NIFTY MARKET FILTER
    // ================================
    let marketBullish = true;
    try {
      const niftyData = await getMarketDataFull('^NSEI', { range: '3mo', interval: '1d' });
      if (niftyData.closes.length >= 30) {
        const niftyAnalysis = analyzeStock(niftyData.closes, niftyData.highs, niftyData.lows, niftyData.volumes);
        marketBullish = niftyAnalysis.trend === 'UPTREND';
        if (!marketBullish) logs.push("⚠️ Market Bearish filter active (NIFTY downtrend)");
      }
    } catch (err) {
      console.warn("NIFTY filter failed:", err);
    }

    // ================================
    // 📊 STOCK UNIVERSE = Nifty 50 only
    // ================================
    const stocks = NIFTY50;
    logs.push(`Scanning ${stocks.length} Nifty 50 stocks...`);

    // ================================
    // 🔁 ANALYZE STOCKS IN PARALLEL BATCHES
    // ================================
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < stocks.length; i += PARALLEL_BATCH_SIZE) {
      const batch = stocks.slice(i, i + PARALLEL_BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (stock) => {
          const symbol = stock.symbol;

          // Skip if already in an open trade
          if (openSymbols.has(symbol)) {
            return { symbol, skipped: "already open" };
          }

          // Fetch market data
          const { closes, highs, lows, volumes } = await getMarketDataFull(symbol, {
            range: '1y',
            interval: '1d',
          });

          if (!closes || closes.length < 50) {
            return { symbol, skipped: `insufficient data (${closes?.length ?? 0} bars)` };
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

          return { symbol, stock, analysis, closes };
        })
      );

      // Process results for this batch
      for (const result of results) {
        if (result.status === 'rejected') {
          logs.push(`Batch error: ${result.reason}`);
          continue;
        }

        const data = result.value;
        if ('skipped' in data) {
          logs.push(`${data.symbol}: ${data.skipped}`);
          continue;
        }

        const { symbol, stock, analysis } = data as {
          symbol: string;
          stock: typeof stocks[0];
          analysis: ReturnType<typeof analyzeStock>;
        };

        // Save signal to DB (all decisions: BUY/HOLD/AVOID)
        await supabase.from("signals").upsert({
          symbol,
          short_name: stock.name,
          decision: analysis.decision,
          score: analysis.score,
          confidence: analysis.confidence,
          price: analysis.price,
          stop_loss: analysis.stopLoss,
          target: analysis.target,
          rsi: analysis.rsi,
          trend: analysis.trend,
          change_pct: analysis.changePercent,
          reason: analysis.signals.join(', '),
          run_date: today,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol,run_date' });

        // Only open new trades for BUY signals with score >= 70
        if (analysis.decision !== "BUY" || analysis.score < MIN_SCORE) {
          logs.push(`${symbol}: ${analysis.decision} (score: ${analysis.score})`);
          continue;
        }

        // Skip if already at max trades
        if (openSymbols.size >= MAX_OPEN_TRADES) {
          logs.push(`${symbol}: BUY signal but max open trades reached`);
          continue;
        }

        // ================================
        // 💰 POSITION SIZING
        // ================================
        const sizing = calculatePositionSize({
          price: analysis.entry,
          stopLoss: analysis.stopLoss,
          currentEquity: currentBalance,
          availableCash: availableCapital,
          riskTier: "AGGRESSIVE",
          strategyWeight: 1,
          capitalLimitPct: MAX_CAPITAL_USAGE,
        });

        if (sizing.quantity <= 0) {
          logs.push(`${symbol}: BUY rejected — sizing returned 0 (risk/capital limit)`);
          continue;
        }

        const tradeValue = analysis.entry * sizing.quantity;
        const buyCharges = calculateBuyCharges(tradeValue);
        const totalCost = tradeValue + buyCharges;

        if (totalCost > availableCapital) {
          logs.push(`${symbol}: BUY rejected — insufficient capital (need ₹${totalCost.toFixed(0)}, have ₹${availableCapital.toFixed(0)})`);
          continue;
        }

        // ================================
        // 📝 INSERT TRADE
        // ================================
        const direction: TradeDirection = "LONG";

        const { error: insertError } = await supabase.from("trades").insert({
          symbol,
          short_name: stock.name,
          sector: stock.sector,
          direction,
          entry_price: analysis.entry,
          buy_price: analysis.entry,
          stop_loss: analysis.stopLoss,
          target: analysis.target,
          initial_stop_loss: analysis.stopLoss,
          highest_price: analysis.entry,
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
          logs.push(`${symbol}: DB insert failed — ${insertError.message}`);
          continue;
        }

        openSymbols.add(symbol);
        availableCapital -= totalCost;
        await updateWallet({ balance: availableCapital });

        logs.push(`✅ ${symbol}: LONG ${sizing.quantity} shares @ ₹${analysis.entry} (score: ${analysis.score})`);
      }
    }

    return NextResponse.json({
      logs,
      executedAt: new Date().toISOString(),
      executedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      openTrades: openSymbols.size,
      availableCapital,
      totalCapital: currentBalance,
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