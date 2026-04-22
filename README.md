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

---

## 2. Core Architectural Principles

### 2.1 Pure Logic vs. Side Effects
- All technical analysis math (RSI, SMA, MACD, ATR) lives in `lib/indicators.ts`.
- The core scoring engine lives in `lib/strategy.ts` (`analyzeStock`). It must remain a **pure function**—it takes price data and returns an analysis result.
- Side effects (DB updates, wallet modifications) are restricted to API routes (`app/api/*`) and `lib/wallet.ts`.

### 2.2 Automation Workflow
- **Trigger**: GitHub Actions (`.github/workflows/daily-strategy.yml`) triggers `/api/run-strategy` every 5 minutes during market hours.
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

## 8. Educational Disclaimer
SwingEdge is a **simulation platform**. It is for educational purposes only. It does not interface with real brokers and should not be used as financial advice.

---
*Last Updated: 21 April 2026*
