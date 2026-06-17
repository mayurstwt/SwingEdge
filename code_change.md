# Required Code Changes to Fix Persistent Losses

This document lists all necessary modifications to the SwingEdge codebase.  
Apply these changes in order to correct the position‑sizing bug, rebalance the scoring logic, improve exit rules, and clean up dead code.

---

## 1. Fix Position Sizing: Use Total Equity (Not Just Cash)

**File:** `app/api/run-strategy/route.ts`

### 1.1 Replace `currentEquity` calculation

Inside the `runStrategy()` function, after loading open trades and wallet, compute **total equity**:

```ts
// Find after: const wallet = await getWallet();
// Add this block:

// Compute total equity = cash + current market value of open positions
let totalEquity = wallet.balance;
const livePrices = new Map<string, number>();

// Fetch live prices for all open trades to get accurate market value
for (const trade of activeOpenTrades) {
  try {
    const { closes } = await breaker.execute(
      'yahoo-finance',
      () => retryWithBackoff(() => withTimeout(getMarketDataFull(trade.symbol, { range: '1d', interval: '5m' }), 10000)),
      { threshold: 2, resetTimeoutMs: 300000 }
    );
    if (closes.length > 0) {
      const livePrice = closes[closes.length - 1];
      livePrices.set(trade.symbol, livePrice);
      totalEquity += livePrice * trade.quantity;
    } else {
      // fallback to buy price
      totalEquity += trade.buy_price * trade.quantity;
    }
  } catch {
    totalEquity += trade.buy_price * trade.quantity;
  }
}
```

### 1.2 Pass `totalEquity` to `calculatePositionSize`

Replace the call to `calculatePositionSize` (around line 250) with:

```ts
const sizing = calculatePositionSize({
  price: livePrice,
  stopLoss: liveStopLoss,
  currentEquity: totalEquity,           // ← changed from currentBalance
  availableCash: availableCapital,
  riskTier: "NORMAL",                   // ← will change later to NORMAL
  strategyWeight: 1,
  capitalLimitPct: MAX_CAPITAL_USAGE,
});
```

### 1.3 Update `availableCapital` after each trade open

After inserting the trade and subtracting the cost, also recalc total equity for subsequent trades (optional but good practice). For simplicity, we can just recompute totalEquity after each close/open.

---

## 2. Rebalance Scoring Logic (Reduce RSI & Bollinger Weights)

**File:** `lib/strategy.ts`

Replace the scoring section (lines ~80–150) with the following balanced weights:

```ts
// ================================
// 📊 REFINED SCORING MODEL (v2.2)
// ================================
let score = 0;

// 1. Long-term Trend (SMA200) = 20 pts
if (sma200 !== null) {
  if (price > sma200) {
    score += 20;
    signals.push('Price above SMA200 (Long-term Bullish)');
  } else {
    score += 5;
    signals.push('Price below SMA200 (Long-term Bearish)');
  }
}

// 2. Medium-term Momentum (SMA50 vs SMA200) = 15 pts
if (sma50 !== null && sma200 !== null) {
  if (sma50 > sma200) {
    score += 15;
    signals.push('SMA50 > SMA200 (Golden cross alignment)');
  } else {
    score -= 10;
    signals.push('SMA50 < SMA200 (Death cross alignment)');
  }
}

// 3. Short-term Momentum (Price vs SMA50) = 15 pts
if (sma50 !== null) {
  if (price > sma50) {
    score += 15;
    signals.push('Price above SMA50 (Bullish momentum)');
  } else {
    score -= 5;
    signals.push('Price below SMA50 (Bearish momentum)');
  }
}

// 4. RSI (Wilder's) – reduced weight, only rewards moderate strength
if (rsi > 50 && rsi < 65) {
  score += 12;                      // reduced from 20
  signals.push('RSI in strength zone (50-65)');
} else if (rsi >= 30 && rsi <= 50) {
  score += 6;                       // neutral zone
  signals.push('RSI neutral (30-50)');
} else if (rsi < 30) {
  // Only add points if price is above SMA200 (uptrend)
  if (sma200 !== null && price > sma200) {
    score += 15;
    signals.push('RSI oversold (<30) in uptrend – bounce opportunity');
  } else {
    score += 0;                     // no points in downtrend
    signals.push('RSI oversold (<30) but no trend confirmation');
  }
} else if (rsi >= 65) {
  // Overbought: no positive points; add a warning signal
  signals.push('RSI overbought (>65) – caution');
}

// 5. Bollinger Bands (Mean Reversion) – reduced weight and only on lower band
if (bb.lower !== null) {
  if (price <= bb.lower * 1.02) {
    // Only add points if trend is up (to avoid catching falling knives)
    if (sma200 !== null && price > sma200) {
      score += 15;                  // reduced from 25
      signals.push('Price at lower Bollinger Band with uptrend – bounce potential');
    } else {
      score += 5;
      signals.push('Price at lower band but no trend confirmation');
    }
  } else if (bb.middle !== null && price > bb.middle) {
    score += 8;                     // reduced from 10
    signals.push('Price above middle Bollinger Band');
  }
}

// 6. MACD (Histogram) = 15 pts – unchanged
if (macd.histogram !== null) {
  if (macd.histogram > 0) {
    score += 15;
    signals.push('MACD positive histogram');
  } else if (macd.histogram > -0.2) {
    score += 5;
    signals.push('MACD flattening (exhaustion)');
  }
}

// 7. Volume Confirmation = 10 pts – unchanged
if (volRatio > 1.3) {
  score += 10;
  signals.push('Strong volume confirmation');
} else if (volRatio > 1.1) {
  score += 5;
  signals.push('Above average volume');
}

// 8. Volatility Penalty – unchanged
const regime = detectMarketRegime(prices, highs, lows);
if (regime === 'VOLATILE') {
  score -= 15;
  signals.push('Volatility penalty (-15)');
}

// Clamp score 0-100
score = Math.max(0, Math.min(100, score));
```

---

## 3. Improve Exit Rules: Wider Trailing Stop & Remove Time Exit

**File:** `app/api/run-strategy/route.ts`

### 3.1 Widen trailing stop multiplier

Find the section that calculates the trailing stop (around line 170). Change:

```ts
// Old:
const trailingStop = (trade.highest_price as number) - (1.5 * atr);

// New:
const trailingStop = (trade.highest_price as number) - (2.0 * atr);
```

### 3.2 Remove the 5‑day max‑hold exit

Delete or comment out the `// ── Time‑based exit: max 5 trading days ──────────────────────` block entirely (lines ~190–200).  
This will allow trades to run longer, capturing more upside.

---

## 4. Switch Risk Tier to `NORMAL`

**File:** `app/api/run-strategy/route.ts`

Change the `riskTier` passed to `calculatePositionSize` from `"AGGRESSIVE"` to `"NORMAL"` as shown in section 1.2.

---

## 5. Remove Duplicate Charge Functions & Use Library

**File:** `app/api/run-strategy/route.ts`

Delete the local `calculateBuyCharges` and `calculateSellCharges` functions (they are duplicates of `calculateCharges` in `lib/wallet.ts`).  
Replace all calls with:

```ts
import { calculateCharges } from '@/lib/wallet';

// For buy:
const buyCharges = calculateCharges(tradeValue, 'buy');

// For sell (inside the trade management loop):
const sellCharges = calculateCharges(currentPrice * trade.quantity, 'sell');
```

---

## 6. Remove Unused / Junk Files

Delete the following files (they are not used anywhere):

- `app/api/tips/generate/route.ts` – unused; SmartTipsPanel uses `/api/tips` POST
- `scripts/worker.js` – only for local dev, not used in production
- (Optional) `app/api/health/route.ts` – if you don’t need external health monitoring

Also, consider removing duplicate `calculateBuyCharges` and `calculateSellCharges` as noted above.

---

## 7. (Optional) Add Momentum Filter to Avoid Chasing

**File:** `lib/strategy.ts`

Add a new condition before returning the analysis to reject signals when price is near a recent high without consolidation:

```ts
// After scoring, check for momentum exhaustion
const recentHigh = Math.max(...prices.slice(-20));
if (price >= recentHigh * 0.98 && rsi > 65) {
  // If price is within 2% of 20‑day high and RSI > 65, reduce score
  score = Math.max(0, score - 10);
  signals.push('Near 20‑day high with RSI >65 – momentum overextended');
}
```

---

## 8. Apply These Changes Systematically

1. **Backup** your current codebase.
2. Apply each change as described.
3. Run `npm run verify` to ensure no new errors.
4. Test with a small paper‑trading run and observe the P&L trend.

If losses persist, consider further reducing the risk tier to `CONSERVATIVE` (0.75%) and lowering the `MIN_SCORE` threshold back to 70 (if you see fewer signals).

---

**End of change list.** Provide this markdown file to an AI assistant to implement the changes automatically.