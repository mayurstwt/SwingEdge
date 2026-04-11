# 📊 SwingEdge — Professional Trading Terminal

**SwingEdge** is an institutional-grade swing trading terminal for Indian NSE stocks. Built with Next.js and Supabase, it features automated paper trading with professional-grade risk management and a transparent audit trail.

---

## 🚀 Pro-Grade Features

- **Multi-Factor Analysis**: Uses RSI (14), MACD (12,26,9), Bollinger Bands (20,2), SMA (50, 200), and ATR Volatility.
- **Institutional Risk Management (Circuit Breakers)**:
    - **5% Daily Drawdown**: Stops all Auto-Buy actions if the total portfolio value drops 5% in a single day.
    - **Concentration Limits**: Limits exposure to any single sector (e.g., Banking, IT) to 25% of total capital.
    - **Volatility Filter**: Automatically avoids stocks with daily volatility (ATR/Price) > 4%.
- **Realistic Execution (Slippage Simulation)**:
    - Every automated trade includes a **0.05% slippage penalty** to simulate real-world market friction.
    - **Liquidity Filter**: Only trades stocks with a 20-day Average Daily Volume > ₹50 Crores.
- **Strategic Refinements**:
    - **No-Gap-Up**: Automatically cancels entries if a stock jumps >2% at the open.
    - **Time-Stop**: Automatically exits positions after **15 trading days** to maximize capital efficiency.
    - **Trend Alignment**: Only buys stocks trading above their 200-day Simple Moving Average (SMA).
- **Audit Trail & Governance**:
    - **"The Why" Log**: Every signal and trade stores its logical justification (e.g., "RSI Oversold + Above 200 SMA").
    - **Strategy Versioning**: Every automated trade is tagged with the logic version used (e.g., `Pro 1.2.0`).

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 16+, Tailwind CSS, Chart.js.
- **Backend**: Next.js API Routes (Serverless via Netlify).
- **Database**: Supabase (PostgreSQL).
- **Automation**: GitHub Actions (Cron triggers).

---

## 🤖 Automation Engine

- **Scan Time**: 9:00 PM IST (Daily).
- **Decision Engine**: `lib/strategy.ts` (Score 70+ for AUTO-BUY).
- **Execution Engine**: `lib/wallet.ts` (Handles slippage, commissions, and capital allocation).

---

## 📈 Paper Portfolio Rules

- **Allocation**: Default of ₹10,000 per automated trade.
- **Brokerage**: Simulates STT (0.1%), Brokerage (Max ₹20), and DP Charges (₹18.8 on Sell).
- **Starting Balance**: ₹0. Use the **+ Deposit** button in the Wallet Panel to seed your account.

---

## 📁 Project Structure

- `/app/api`: Serverless trading routes.
- `/lib`:
    - `indicators.ts`: Quantitative math.
    - `strategy.ts`: Pro-Logic version `1.2.0`.
    - `wallet.ts`: Brokerage & Slippage engine.
    - `supabase.ts`: Database interfaces.

---

## ⚖️ Disclaimer
This tool is for **educational/simulation purposes only**. Trading involves real risk. Always consult a professional before making actual investments.
