# 🤖 Automation & Passive Income Guide

This guide explains how to run your SwingEdge trading terminal autonomously for passive income.

## 1. How to Start Automation

We have added a background worker that triggers your trading strategy every 5 minutes.

### 🏃‍♂️ Running Locally
Open a new terminal in your project directory and run:
```bash
npm run worker
```
Keep this terminal open. It will log every buy/sell action it takes.

### ☁️ Running in the Cloud (Free Forever)
The best way to run this for free is using **GitHub Actions**.

1. I have created a file at `.github/workflows/automate-trading.yml`.
2. Push this file to your GitHub repository.
3. GitHub will now automatically hit your Netlify API every 5 minutes.
4. **Important**: Go to your Netlify dashboard and make sure your Site Name matches the one in the workflow file.

---

## 2. Dynamic Diagnostics

We have improved the "Daily Signals" dashboard. If a stock you like (e.g., NESTLEIND) is not being bought, the backend will now log a specific reason:

- **"Market Bearish filter active"**: The NIFTY 50 trend is weak. The system is protecting you from a market crash.
- **"Score X below threshold Y"**: The strategy is being picky because recent trades didn't perform well.
- **"Max open trades reached"**: You already have 5 trades. Sell one or increase `MAX_OPEN_TRADES`.
- **"Capital usage exceeds limit"**: You have already invested 70% of your funds.

---

## 3. Passive Income Tips

To make this truly "passive," consider these adjustments in `app/api/run-strategy/route.ts`:

### A. Increase Capacity
If you have a large capital, increase the allowed open trades:
```typescript
const MAX_OPEN_TRADES = 10; // Increased from 5
const MAX_CAPITAL_USAGE = 0.9; // Use 90% of funds
```

### B. Manual Override
If you are 100% sure about a stock and want to ignore the Nifty filter, you can hit the API with:
```json
{ "bypassMarketFilter": true }
```

### C. Risk Management
The system uses "Risk Tiers" (Conservative, Normal, Aggressive).
- If you want more trades, ensure your **Wallet Balance** is at least ₹50,000.
- Smaller balances might result in "sizing rejected" because the risk-per-share is too high for a small portfolio.

---

## 4. Maintenance
- **Check the Dashboard once a week**: Review your "Closed Trades" to see if the strategy needs tweaking.
- **Reset/Top-up**: If your balance gets low due to paper trading "losses," use the **DEPOSIT** button in the Wallet Panel to add more simulated funds.

> [!TIP]
> **Pro Tip**: Set up a Discord or Slack webhook in the `worker.js` if you want to get notified on your phone every time a trade is made!
