# SwingEdge — Technical Specification & Governance Manual

> [!IMPORTANT]
> This document is the **Source of Truth** for the SwingEdge project. Any modification to the codebase must adhere to the rules and architectural patterns defined here. Future AI agents must read and respect these constraints to maintain system integrity.

---

## 1. System Overview
SwingEdge is a high-frequency algorithmic swing trading terminal for the NSE (National Stock Exchange of India). It combines real-time technical analysis and automated paper trading into a single dashboard.

### Core Stack
- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript (Strict Mode)
- **Database**: Supabase (PostgreSQL + Realtime)
- **Math/Charts**: Chart.js 4+
- **Data Source**: Yahoo Finance API (v8/chart)
- **News Source**: Google News RSS + Economic Times Markets RSS

---

## 2. Core Architectural Principles

### 2.1 Pure Logic vs. Side Effects
- All technical analysis math (RSI, SMA, MACD, ATR) lives in `lib/indicators.ts`.
- The core scoring engine lives in `lib/strategy.ts` (`analyzeStock`). It must remain a **pure function**—it takes price data and returns an analysis result.
- Side effects (DB updates, wallet modifications) are restricted to API routes (`app/api/*`) and `lib/wallet.ts`.

### 2.2 Automation Workflow
- **Trigger**: Supabase Cron (`pg_cron`) triggers `/api/run-strategy` every 5 minutes during market hours via `pg_net` HTTP POST.
- **Worker**: A local `scripts/worker.js` exists for dev/local testing.
- **Orchestration**: `/api/run-strategy` is the "Brain". It loads stocks, analyzes them, checks open trades, manages trailing stops, and opens new positions.

---

## 3. Critical Trading Rules (Immutable)

### 3.1 Recommendation Thresholds
The system must remain **Conservative**.
- **BUY**: Minimum score of **70**.
- **HOLD**: Score between **50 and 69**.
- **AVOID**: Score below **50**.
- *Rationale*: To prevent "Early Entry" traps and minimize drawdown.

### 3.2 Risk Management
- **Position Sizing**: NEVER hardcode quantity. Use `calculatePositionSize` from `lib/trading/risk.ts`.
- **Risk Tiers**:
  - `CONSERVATIVE`: 0.75% risk per trade.
  - `NORMAL`: 1.25% risk per trade.
  - `AGGRESSIVE`: 2.0% risk per trade.
- **Capital Limit**: Never use more than **90%** of available cash.
- **Sector Limit**: Max exposure per sector should be monitored to avoid concentration risk.

### 3.3 Exit Strategy
- **Trailing Stop**: 1.5x ATR from the highest price touched since entry.
- **Target**: 2.2x ATR from entry.
- **Partial Exit**: Book 50% profit at Target 1; let the rest run with a trailing stop.

---

## 4. Database Schema (Supabase)

| Table | Purpose | Key Fields |
| :--- | :--- | :--- |
| `signals` | Daily scan results | `symbol`, `score`, `decision`, `run_date` |
| `trades` | Paper trading ledger | `buy_price`, `status` (OPEN/CLOSED), `pnl` |
| `wallet` | Virtual bank | `balance`, `updated_at` |
| `market_news` | Cached Daily News feed | `source`, `title`, `link`, `symbols`, `published_at` |
| `trade_tips` | Multi-factor trade ideas | `tip_type`, `composite_score`, `suggested_price`, `status` |

---

## 5. Strategy Logic: "Static Trader v2.0"

The system uses a **Static Scoring** model:
1. **Indicator Weights**: Trend (SMA200) = 20pts, RSI = 20pts, MACD = 15pts, Volatility = -10pts (if high).
2. **Market Filter**: Analyzes `^NSEI` (NIFTY 50). If the broad market is in a `DOWNTREND`, it subtracts 10 points from all individual stock scores.

---

## 6. Development Workflow Rules

1. **Type Safety**: No `any`. All results from Supabase must be typed using `SignalRow` or `TradeRow` from `lib/supabase.ts`.
2. **UI Aesthetic**: Maintain the "Dark Professional" theme. Use CSS variables from `app/globals.css`.
3. **Data Integrity**: When updating `trades`, always update the `wallet` balance in the same transaction/request to prevent desync.
4. **Logging**: Every automated run must return a `logs` array. Log reasons for every "Skip" or "Buy".

---

## 7. How to Modify the System (For AI & Humans)

### To change Signal Logic:
Modify `lib/strategy.ts`. Test using the "Live Analysis" tab in the UI.

### To change Risk/Position Sizing:
Modify `lib/trading/risk.ts`. Ensure `calculatePositionSize` is updated across all callers.

### To add new Indicators:
Add to `lib/indicators.ts`, then integrate into `analyzeStock` in `lib/strategy.ts`.

---

## 8. Daily News Feature

SwingEdge now includes a `Daily News` tab beside `Live Analysis` and `Daily Signals`.

### What it does
- Aggregates free Indian market headlines from Google News RSS and Economic Times Markets RSS.
- Tags headlines against the tracked NSE stock universe in `data/stocks.json`.
- Highlights articles related to currently open paper trades.
- Caches headlines in Supabase table `market_news` when that table exists.
- Falls back to live feed mode if the `market_news` table has not been created yet.

### Daily News file map
- Added: `app/components/DailyNewsPanel.tsx`
- Added: `app/api/news/route.ts`
- Added: `app/api/news/refresh/route.ts`
- Added: `lib/news.ts`
- Changed: `app/page.tsx`
- Changed: `app/globals.css`
- Changed: `lib/supabase.ts`
- Changed: `supabase/schema.sql`
- Changed: `package.json`
- Changed: `package-lock.json`
- Changed: `README.md`

### How to remove the Daily News feature
1. Delete:
   `app/components/DailyNewsPanel.tsx`, `app/api/news/route.ts`, `app/api/news/refresh/route.ts`, `lib/news.ts`
2. Revert Daily News tab wiring from:
   `app/page.tsx`
3. Revert Daily News styles from:
   `app/globals.css`
4. Remove `market_news` types from:
   `lib/supabase.ts`
5. Remove the `market_news` table and RLS policy from:
   `supabase/schema.sql`
6. Remove the `rss-parser` dependency from:
   `package.json` and `package-lock.json`
7. Remove this README section.

---

## 9. Educational Disclaimer
SwingEdge is a **simulation platform**. It is for educational purposes only. It does not interface with real brokers and should not be used as financial advice.

---
*Last Updated: 12 May 2026*

---

## 9A. Smart Trade Tips

SwingEdge now includes a `Smart Tips` tab beside `Daily News`.

### What it does
- Reuses the existing technical score from `signals`.
- Adds a market-context modifier from the NIFTY trend.
- Adds a cached-news sentiment modifier from `market_news`.
- Sizes ideas with the existing conservative risk engine.
- Stores suggestions in `trade_tips` and lets the user either ignore them or open a paper trade directly.

### Core files
- Added: `app/components/SmartTipsPanel.tsx`
- Added: `app/api/tips/route.ts`
- Added: `app/api/tips/generate/route.ts`
- Added: `app/api/tips/[id]/action/route.ts`
- Added: `lib/tips.ts`
- Added: `tests/unit/tips.test.ts`
- Changed: `app/api/run-strategy/route.ts`
- Changed: `app/page.tsx`
- Changed: `app/globals.css`
- Changed: `lib/supabase.ts`
- Changed: `supabase/schema.sql`

---

## 10. Testing & Production Checklist

### Pre-Production Command
Before deploying to production, run the following unified verification command to ensure all types, linting rules, and tests pass:

```bash
npm run lint && npm run verify && npm run build
```

*(Note: `npm run verify` internally runs `vitest run` and the `scripts/sanity-check.js` script to validate Supabase & external API connectivity).*

### Detailed Test Cases

#### A. Core Services (`lib/indicators.ts`, `lib/strategy.ts`)
1. **SMA & EMA Calculations:**
   - *Test:* Feed array of constant prices.
   - *Expected:* Moving averages exactly match the price.
2. **RSI Calculation:**
   - *Test:* Feed pure ascending prices, then pure descending prices.
   - *Expected:* RSI evaluates near 100 for uptrend and near 0 for downtrend.
3. **MACD Generation:**
   - *Test:* Verify MACD line, Signal line, and Histogram align with known price trajectories (e.g., golden cross).
   - *Expected:* Histogram outputs > 0 when MACD line > Signal line.
4. **Scoring Logic (`analyzeStock`):**
   - *Test:* Feed perfect bullish setup (Price > SMA200, SMA50 > SMA200, RSI between 50-70, MACD > 0, Price > SMA50, BB bounce, High Volume).
   - *Expected:* Score calculates exactly to **100** points.
   - *Test:* Feed a volatile downtrend pattern.
   - *Expected:* Score evaluates < 50, triggering an **AVOID** decision.
5. **NIFTY Market Filter:**
   - *Test:* Manually set broad market to `DOWNTREND` regime.
   - *Expected:* Strategy correctly applies a -10 point penalty.

#### B. API & Trading Processes (`app/api/run-strategy/route.ts`)
1. **Cron Security Check:**
   - *Test:* Execute `GET /api/run-strategy` without `x-cron-secret` in production.
   - *Expected:* Rejects request with `401 Unauthorized`.
2. **Idempotency Guard:**
   - *Test:* Trigger the strategy twice within the same minute.
   - *Expected:* Second execution is aborted and returns `skipped: true`.
3. **Capital limit & Position Sizing:**
   - *Test:* Attempt a new BUY when `wallet.balance` < required trade amount or open trades >= `MAX_OPEN_TRADES`.
   - *Expected:* Trade is logged as rejected due to limits.
4. **Open Trade Trailing Stop Logic:**
   - *Test:* Mock current price dipping below the dynamic `trailingStop`.
   - *Expected:* Trade `status` is set to `CLOSED` and `pnl` is logged correctly.
5. **Circuit Breaker & Fallback:**
   - *Test:* Mock Yahoo Finance API failure.
   - *Expected:* Circuit breaker trips after 3 failures; uses cached daily closes instead of intraday data.

#### C. Wallet & PnL (`lib/wallet.ts`)
1. **Buy/Sell Commission Calculations:**
   - *Test:* Perform a paper trade of ₹1,00,000.
   - *Expected:* Correct deduction of brokerage, STT, transaction charges, and GST.
2. **Database Syncing:**
   - *Test:* Complete a profitable `LONG` paper trade.
   - *Expected:* Supabase `wallet` table reflects original balance + net PnL (profit minus charges).
