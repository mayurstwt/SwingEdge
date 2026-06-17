import { NextRequest, NextResponse } from "next/server";
import { analyzeStock } from "@/lib/strategy";
import { getMarketDataFull } from "@/lib/trading/market-data";
import { fetchYahooChart } from "@/lib/yahoo-finance";
import { calculatePositionSize } from "@/lib/trading/risk";
import { getWallet, updateWallet, calculatePnL } from "@/lib/wallet";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TradeDirection } from "@/lib/trading/types";
import NIFTY50 from "@/data/stocks.json";

import { getOrCreateStrategyRun, updateStrategyRun } from "@/lib/idempotency";
import { StrategyLogger } from "@/lib/logger";
import { checkDrawdownLimit } from "@/lib/trading/drawdown";
import { withTimeout } from "@/lib/timeout";
import { retryWithBackoff } from "@/lib/retry";
import { breaker } from "@/lib/circuit-breaker";
import { getISTNow, isMarketOpen, isTradingDay } from "@/lib/market-hours";
import { expireTradeTips, generateTipsForCandidates, persistTradeTips, type TipCandidate } from "@/lib/tips";

const MAX_OPEN_TRADES = 5;
const MAX_CAPITAL_USAGE = 0.9;
const MIN_SCORE = 75; // BUY threshold — raised from 70: fewer but higher-quality signals
const PARALLEL_BATCH_SIZE = 5; // fetch Yahoo Finance in parallel batches

async function validateCron(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  
  // 1. Allow in development environment
  if (process.env.NODE_ENV === 'development') {
    return null;
  }

  // 2. Allow if secret matches
  if (expectedSecret && cronSecret === expectedSecret) {
    return null;
  }

  // 3. Allow if request is from same origin (browser dashboard)
  const host = req.headers.get('host');
  const referer = req.headers.get('referer');
  if (referer && host && referer.includes(host)) {
    return null;
  }
  
  if (!expectedSecret) {
    return { error: 'Server not configured. Missing CRON_SECRET', status: 500 };
  }
  
  return { error: 'Unauthorized. Invalid cron secret.', status: 401 };
}

// Handle both GET (cron) and POST (manual/dashboard) requests
export async function GET(req: NextRequest) {
  const authError = await validateCron(req);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
  return runStrategy();
}

export async function POST(req: NextRequest) {
  const authError = await validateCron(req);
  if (authError) return NextResponse.json({ error: authError.error }, { status: authError.status });
  return runStrategy();
}

/**
 * Fetch the current live price for a symbol using intraday data.
 * Falls back to the daily close if intraday data is unavailable.
 */
async function fetchLivePrice(symbol: string, fallbackPrice: number, logger: StrategyLogger): Promise<number> {
  try {
    const { closes } = await breaker.execute(
      'yahoo-finance',
      () => retryWithBackoff(() => withTimeout(
        getMarketDataFull(symbol, { range: '1d', interval: '5m' }),
        10000,
        'Yahoo Finance intraday'
      )),
      { threshold: 3, resetTimeoutMs: 300000 }
    );

    if (closes.length > 0) {
      const livePrice = closes[closes.length - 1];
      logger.debug(`${symbol}: live price ₹${livePrice} (from ${closes.length} intraday bars)`);
      return livePrice;
    }
  } catch {
    logger.warn(`${symbol}: intraday price fetch failed, using daily close ₹${fallbackPrice}`);
  }
  return fallbackPrice;
}

async function runStrategy() {
  // ================================
  // ⏰ MARKET HOURS GUARD
  // ================================
  // Allow signals to be generated on trading days even outside market hours,
  // but only execute actual BUY trades during market hours.
  // Buffer of 5 min allows the strategy to run at 9:10 AM (pre-market prep).
  const marketStatus = await isMarketOpen(5);
  const tradingDay = await isTradingDay();

  if (!tradingDay) {
    return NextResponse.json({
      skipped: true,
      reason: marketStatus.reason,
      currentTimeIST: marketStatus.currentTimeIST,
    });
  }

  // canTrade = market is open (with buffer); if false, we still generate signals but skip trade execution
  const canExecuteTrades = marketStatus.isOpen;

  const istNow = getISTNow();
  const today = istNow.dateStr;
  // Lock key is per 5-minute window — prevents duplicate runs within the same window
  // but allows manual retries after 5 minutes if the previous run failed.
  const lockKey = `strategy_lock_${today}_${Math.floor(Date.now() / (5 * 60000)) * (5 * 60000)}`;
  
  const runStatus = await getOrCreateStrategyRun(lockKey);
  if (!runStatus.isNewRun) {
    return NextResponse.json({ skipped: true, reason: runStatus.reason });
  }

  const logger = new StrategyLogger(runStatus.runId);
  logger.info(`Starting strategy run: ${lockKey}`);
  logger.info(`Market status: ${marketStatus.reason} | Can execute trades: ${canExecuteTrades}`);

  let tradesOpened = 0;
  let tradesClosed = 0;
  let tipsGenerated = 0;

  try {
    const drawdown = await checkDrawdownLimit(20);
    if (drawdown.breached) {
      logger.error(`Drawdown limit breached: ${drawdown.drawdownPercent}%`, undefined, { currentEquity: drawdown.currentEquity });
      await updateStrategyRun(runStatus.runId, { status: 'FAILED', error_message: 'Drawdown protection triggered' });
      await logger.flush();
      return NextResponse.json({ skipped: true, reason: 'Drawdown protection triggered', drawdown }, { status: 200 });
    }

    const supabase = getSupabaseAdmin();
    const wallet = await getWallet();
    if (!wallet) {
      throw new Error("Wallet not found");
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
      throw new Error("Failed to load open trades");
    }

    const activeOpenTrades = openTrades ?? [];

    // ================================
    // 🔁 MANAGE OPEN TRADES (Trailing Stop & Target)
    // ================================
    if (activeOpenTrades.length > 0) {
      for (const trade of activeOpenTrades) {
        try {
          const { closes, highs } = await breaker.execute(
            'yahoo-finance',
            () => retryWithBackoff(() => withTimeout(getMarketDataFull(trade.symbol, { range: '1mo', interval: '1d' }), 15000, 'Yahoo Finance API')),
            { threshold: 3, resetTimeoutMs: 300000 }
          );

          if (!closes.length) {
            logger.warn(`${trade.symbol}: no market data for exit check`);
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
            trade.highest_price = currentHigh; // Update local for trailing stop calc below
          }

          // ── Break-Even Logic ────────────────────────────────────────
          // If profit reaches 50% of target distance, move SL to entry
          // Only move if current SL is still below entry price
          if (trade.direction === "LONG" && trade.stop_loss < trade.buy_price) {
            const targetDistance = trade.target - trade.buy_price;
            const halfwayPoint = trade.buy_price + (targetDistance * 0.5);
            
            if (currentPrice >= halfwayPoint) {
              await supabase
                .from("trades")
                .update({ stop_loss: trade.buy_price })
                .eq("id", trade.id);
              logger.info(`${trade.symbol}: profit reached 50% of target — moving Stop Loss to BREAK-EVEN (₹${trade.buy_price})`);
              trade.stop_loss = trade.buy_price; // Update local for exit check below
            }
          }

          let shouldClose = false;
          let closeReason = "";

          if (trade.direction === "LONG") {
            if (currentPrice >= trade.target) {
              shouldClose = true;
              closeReason = "target hit";
            } else if (trade.highest_price && trade.initial_stop_loss) {
              // Trailing stop: use 1.5× the real ATR distance (target was set at 3.0×ATR)
              const atr = (trade.target - trade.buy_price) / 3.0;
              const trailingStop = (trade.highest_price as number) - (1.5 * atr);
              if (currentPrice <= trailingStop) {
                shouldClose = true;
                closeReason = "trailing stop";
              }
            } else if (currentPrice <= trade.stop_loss) {
              shouldClose = true;
              closeReason = "stop loss";
            }
          }

          // ── Time-based exit: max 5 trading days ──────────────────────
          // Prevents open losers from dragging on indefinitely.
          if (!shouldClose && trade.opened_at) {
            const daysHeld = tradingDaysBetween(new Date(trade.opened_at), new Date());
            if (daysHeld >= 5) {
              shouldClose = true;
              closeReason = `max hold period (${daysHeld} trading days)`;
              logger.warn(`${trade.symbol}: forcing exit after ${daysHeld} trading days`);
            }
          }

          if (shouldClose) {
            const pnl = calculatePnL(
              trade.direction as TradeDirection,
              trade.buy_price,
              currentPrice,
              trade.quantity
            );

            const sellCharges = calculateSellCharges(currentPrice * trade.quantity);
            const netPnL = pnl - sellCharges;

            await supabase
              .from("trades")
              .update({
                sell_price: currentPrice,
                pnl: netPnL,
                profit_loss: netPnL,
                status: "CLOSED",
                closed_at: new Date().toISOString(),
              })
              .eq("id", trade.id);

            availableCapital += (currentPrice * trade.quantity) - sellCharges;
            await updateWallet({ balance: availableCapital });

            logger.info(`${trade.symbol}: closed at ₹${currentPrice} (${closeReason}, PnL: ₹${netPnL.toFixed(2)})`);
            tradesClosed++;
          }
        } catch (e) {
          logger.error(`Error managing open trade for ${trade.symbol}`, e instanceof Error ? e : new Error(String(e)));
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
    const tipCandidates: TipCandidate[] = [];

    // ================================
    // 🚫 LIMIT CHECKS
    // ================================
    if (openTradeCount >= MAX_OPEN_TRADES) {
      logger.info(`Max open trades reached (${openTradeCount}/${MAX_OPEN_TRADES})`);
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
    let marketBearish = false;
    try {
      const niftyData = await breaker.execute(
        'yahoo-finance',
        () => retryWithBackoff(() => withTimeout(getMarketDataFull('^NSEI', { range: '3mo', interval: '1d' }), 15000)),
        { threshold: 3, resetTimeoutMs: 300000 }
      );
      if (niftyData.closes.length >= 30) {
        const niftyAnalysis = analyzeStock(niftyData.closes, niftyData.highs, niftyData.lows, niftyData.volumes);
        marketBullish = niftyAnalysis.trend === 'UPTREND';
        marketBearish = niftyAnalysis.trend === 'DOWNTREND';
        if (marketBearish) logger.warn("⚠️ Market Bearish filter active (NIFTY downtrend)");
      }
    } catch (_err) {
      logger.warn("NIFTY filter failed", _err);
    }

    // ================================
    // 📊 STOCK UNIVERSE = Nifty 50 only
    // ================================
    const stocks = NIFTY50;
    logger.info(`Scanning ${stocks.length} Nifty 50 stocks...`);

    // ================================
    // 🔁 ANALYZE STOCKS IN PARALLEL BATCHES
    // ================================
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
          const { closes, highs, lows, volumes } = await breaker.execute(
            'yahoo-finance',
            () => retryWithBackoff(() => withTimeout(getMarketDataFull(symbol, { range: '1y', interval: '1d' }), 15000)),
            { threshold: 3, resetTimeoutMs: 300000 }
          );

          if (!closes || closes.length < 50) {
            return { symbol, skipped: `insufficient data (${closes?.length ?? 0} bars)` };
          }

          const analysis = analyzeStock(closes, highs, lows, volumes);

          // ─── Fetch live price from Yahoo meta ────────────────────────────
          // closes.at(-1) from a 1y/1d daily series is the last *completed*
          // daily bar — yesterday's close while the market is open today.
          // meta.regularMarketPrice is the true real-time last-trade price.
          let livePrice: number = analysis.price ?? closes[closes.length - 1];
          try {
            const quoteMeta = await breaker.execute(
              'yahoo-finance',
              () => retryWithBackoff(() => withTimeout(
                fetchYahooChart(symbol, '1d', '1d', 8000, 1),
                8000,
                'Yahoo meta fetch'
              )),
              { threshold: 3, resetTimeoutMs: 300000 }
            );
            const rawLive = quoteMeta.meta?.regularMarketPrice;
            if (typeof rawLive === 'number' && rawLive > 0) {
              livePrice = rawLive;
            }
          } catch {
            logger.debug(`${symbol}: meta price fetch failed, using daily close ₹${livePrice}`);
          }
          // ─────────────────────────────────────────────────────────────────

          // Apply market filter penalty
          if (marketBearish) {
            analysis.score = Math.max(0, analysis.score - 10);
            analysis.signals.push("Score adjusted -10 (bear market)");
            if (analysis.score >= 70) analysis.decision = 'BUY';
            else if (analysis.score >= 50) analysis.decision = 'HOLD';
            else analysis.decision = 'AVOID';
          }

          return { symbol, stock, analysis, closes, signalPrice: livePrice };
        })
      );

      // Process results for this batch
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error(`Batch error: ${result.reason}`);
          continue;
        }

        const data = result.value;
        if ('skipped' in data) {
          logger.debug(`${data.symbol}: ${data.skipped}`);
          continue;
        }

        const { symbol, stock, analysis, signalPrice } = data as {
          symbol: string;
          stock: typeof stocks[0];
          analysis: ReturnType<typeof analyzeStock>;
          signalPrice: number;
        };

        // Save signal to DB — use signalPrice (regularMarketPrice) not closes.at(-1)
        await supabase.from("signals").upsert({
          symbol,
          short_name: stock.name,
          decision: analysis.decision,
          score: analysis.score,
          confidence: analysis.confidence,
          price: signalPrice,
          stop_loss: analysis.stopLoss,
          target: analysis.target,
          rsi: analysis.rsi,
          trend: analysis.trend,
          change_pct: analysis.changePercent,
          reason: analysis.signals.join(', '),
          run_date: today,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol,run_date' });

        if (analysis.score >= 60) {
          const atrDistance = analysis.target - analysis.entry;
          const slDistance = analysis.entry - analysis.stopLoss;
          const tipPrice = signalPrice;
          const tipStopLoss = parseFloat((tipPrice - slDistance).toFixed(2));
          const tipTarget = parseFloat((tipPrice + atrDistance).toFixed(2));

          if (tipStopLoss < tipPrice && tipTarget > tipPrice) {
            tipCandidates.push({
              symbol,
              shortName: stock.name,
              sector: stock.sector,
              technicalScore: analysis.score,
              price: tipPrice,
              stopLoss: tipStopLoss,
              target: tipTarget,
              riskReward: analysis.riskReward ?? null,
              trend: analysis.trend,
              signals: analysis.signals,
              runId: runStatus.runId,
            });
          }
        }

        // Only open new trades for BUY signals with score >= MIN_SCORE
        if (analysis.decision !== "BUY" || analysis.score < MIN_SCORE) {
          logger.debug(`${symbol}: ${analysis.decision} (score: ${analysis.score})`);
          continue;
        }

        // ── Hard stop in BEARISH market ───────────────────────────────
        // A -10 score penalty still allows BUY at 70+. Instead we halt
        // all new entries when the broad market is in downtrend.
        if (marketBearish) {
          logger.warn(`${symbol}: BUY (score: ${analysis.score}) rejected — NIFTY is in DOWNTREND, no new entries today`);
          continue;
        }

        // ================================
        // ⏰ MARKET HOURS CHECK FOR TRADE EXECUTION
        // ================================
        if (!canExecuteTrades) {
          logger.warn(`${symbol}: BUY signal (score: ${analysis.score}) but market is closed — reason: ${marketStatus.reason} | time: ${marketStatus.currentTimeIST}`);
          continue;
        }

        // Skip if already at max trades
        if (openSymbols.size >= MAX_OPEN_TRADES) {
          logger.debug(`${symbol}: BUY signal but max open trades reached`);
          continue;
        }

        // ================================
        // 📈 FETCH LIVE PRICE FOR ENTRY
        // ================================
        const livePrice = await fetchLivePrice(symbol, analysis.entry, logger);

        // Recalculate stop loss & target relative to the live price
        // Keep the same ATR-based distance as the analysis
        const atrDistance = analysis.target - analysis.entry; // 2.2 * ATR
        const slDistance = analysis.entry - analysis.stopLoss; // 1.0 * ATR
        const liveStopLoss = parseFloat((livePrice - slDistance).toFixed(2));
        const liveTarget = parseFloat((livePrice + atrDistance).toFixed(2));

        // Reject if live price deviates > 8% from analysis price (stale signal)
        // Using 8% to account for normal intraday gap vs yesterday's daily close
        const priceDeviation = Math.abs(livePrice - analysis.entry) / analysis.entry;
        if (priceDeviation > 0.08) {
          logger.warn(`${symbol}: BUY rejected — live price ₹${livePrice} deviates ${(priceDeviation * 100).toFixed(1)}% from signal price ₹${analysis.entry} (threshold: 8%)`);
          continue;
        }

        // ── Reject gap-up entries > 1.5% ────────────────────────────────
        // When a stock gaps up significantly from yesterday's close, the
        // stop-loss and target were computed at the lower price. Buying after
        // the gap-up means the R:R math is invalidated before we even enter.
        // e.g. Signal at ₹208 → SL ₹195, Target ₹248. Gap-up opens at ₹215.
        //      Effective risk from ₹215 to ₹195 = ₹20. But target ₹248 is only ₹33 away.
        //      Real R:R has shrunk. Skip these trades.
        const gapUpPct = (livePrice - analysis.entry) / analysis.entry;
        if (gapUpPct > 0.015) {
          logger.warn(`${symbol}: BUY rejected — gapped up ${(gapUpPct * 100).toFixed(1)}% from signal price ₹${analysis.entry} (max: 1.5%)`);
          continue;
        }

        // ================================
        // 💰 POSITION SIZING (using live price)
        // ================================
        const sizing = calculatePositionSize({
          price: livePrice,
          stopLoss: liveStopLoss,
          currentEquity: currentBalance,
          availableCash: availableCapital,
          riskTier: "AGGRESSIVE",
          strategyWeight: 1,
          capitalLimitPct: MAX_CAPITAL_USAGE,
        });

        if (sizing.quantity <= 0) {
          logger.debug(`${symbol}: BUY rejected — sizing returned 0 (risk/capital limit)`, { riskPerShare: sizing.riskPerShare, availableCash: availableCapital });
          continue;
        }

        const tradeValue = livePrice * sizing.quantity;
        const buyCharges = calculateBuyCharges(tradeValue);
        const totalCost = tradeValue + buyCharges;

        if (totalCost > availableCapital) {
          logger.debug(`${symbol}: BUY rejected — insufficient capital (Cost: ₹${totalCost.toFixed(2)}, Available: ₹${availableCapital.toFixed(2)})`);
          continue;
        }

        // ================================
        // 📝 INSERT TRADE (at live price)
        // ================================
        const direction: TradeDirection = "LONG";

        const { error: insertError } = await supabase.from("trades").insert({
          symbol,
          short_name: stock.name,
          sector: stock.sector,
          direction,
          buy_price: livePrice,
          stop_loss: liveStopLoss,
          target: liveTarget,
          initial_stop_loss: liveStopLoss,
          highest_price: livePrice,
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
          logger.error(`${symbol}: DB insert failed`, insertError);
          continue;
        }

        openSymbols.add(symbol);
        availableCapital -= totalCost;
        await updateWallet({ balance: availableCapital });

        logger.info(`✅ ${symbol}: LONG ${sizing.quantity} shares @ ₹${livePrice} (live price, signal: ₹${analysis.entry}, score: ${analysis.score})`);
        tradesOpened++;
      }
    }

    try {
      await expireTradeTips();

      const marketTrend = marketBearish ? 'DOWNTREND' : marketBullish ? 'UPTREND' : 'SIDEWAYS';
      const generatedTips = await generateTipsForCandidates(tipCandidates, marketTrend);
      tipsGenerated = await persistTradeTips(generatedTips);
      logger.info(`Generated ${tipsGenerated} smart trade tips`);
    } catch (tipError) {
      logger.warn('Smart trade tip generation failed', tipError);
    }

    await updateStrategyRun(runStatus.runId, { status: 'SUCCESS', trades_opened: tradesOpened, trades_closed: tradesClosed });
    await logger.flush();

    return NextResponse.json({
      executedAt: new Date().toISOString(),
      executedAtIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      marketOpen: canExecuteTrades,
      marketStatus: marketStatus.reason,
      openTrades: openSymbols.size,
      tradesOpened,
      tradesClosed,
      tipsGenerated,
      availableCapital,
      totalCapital: currentBalance,
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Strategy failed", error);
    await updateStrategyRun(runStatus.runId, { status: 'FAILED', error_message: error.message });
    await logger.flush();
    return NextResponse.json({ error: "Strategy failed" }, { status: 500 });
  }
}

// ================================
// 📅 TRADING DAYS HELPER
// ================================
/**
 * Count the number of weekdays (Mon–Fri) between two dates.
 * Used for the 5-trading-day max hold period exit.
 */
function tradingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++; // exclude Sunday=0, Saturday=6
  }
  return count;
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
