# SwingEdge

SwingEdge is a stock market practice app.

It helps you:

- look at Indian NSE stocks
- check whether a stock looks like a `BUY`, `HOLD`, or `AVOID`
- save signals in a database
- do paper trading
- test trading ideas on old market data
- track performance with charts

This app is for learning and testing. It is **not** for placing real money trades.

## What This App Is In Simple Words

Imagine you had a robot helper for stock trading.

That helper:

- studies price charts
- checks some rules
- decides if a stock looks strong or weak
- manages risk
- keeps a record of trades
- learns which type of trades work better over time

That is what SwingEdge does.

It is like a trading lab where you can test ideas before risking real money.

## Main Idea

The app is trying to answer one question:

**"If I have limited money, how can I take smarter trades and avoid bad ones?"**

To do that, it uses:

- technical indicators
- risk management
- strategy scoring
- backtesting
- performance tracking

## What You Can Do In The App

### 1. Live Analysis

You can search for a stock and the app will analyze it.

It shows:

- current price
- RSI
- MACD
- SMA 50
- SMA 200
- Bollinger Bands
- ATR
- trend
- score
- final decision: `BUY`, `HOLD`, or `AVOID`

It also gives:

- a stop-loss
- a target
- a risk-reward ratio
- a short reason explaining the decision

### 2. Daily Signals

The app can scan many stocks and save the best signals for the day.

It checks stocks and stores:

- symbol
- price
- score
- decision
- trend
- RSI
- stop-loss
- target
- reason

This makes it easy to see which stocks looked strong on the latest scan.

### 3. Paper Trading

Paper trading means fake trading with virtual money.

This is useful because:

- you can practice without losing real money
- you can test whether your system works
- you can learn how position sizing and stop-losses behave

The app keeps track of:

- wallet balance
- open trades
- closed trades
- total profit/loss
- best trade
- worst trade

### 4. Backtesting

Backtesting means running your strategy on **past** stock data.

Instead of asking, “What should I buy today?”, backtesting asks:

**“If I had used this system in the past, what would have happened?”**

The app simulates trades candle by candle, so it behaves more like a real system.

It records:

- equity curve
- drawdown curve
- total return
- win rate
- average risk-reward
- complete trade log

### 5. Strategy Diagnostics

Not every trade style works equally well.

Some styles may be better than others.

The app tracks that too.

It compares things like:

- entry type
- sector
- risk-reward bucket
- win rate
- total profit

This helps the system become more data-driven instead of blindly using one fixed rule.

## Features Explained Like You Are 15

### Signals

A signal is the app saying:

- “This stock looks interesting”
- “This stock looks okay”
- “This stock looks risky”

That is why signals are shown as:

- `BUY`
- `HOLD`
- `AVOID`

### Score

The score is like marks in an exam.

If the stock matches more good conditions, it gets a higher score.

Higher score usually means:

- trend is better
- momentum is healthier
- volume support is stronger

### RSI

RSI tells if a stock may be:

- too weak
- healthy
- too hot

Very high RSI can mean the stock has already moved too much.
Very low RSI can mean weakness.

### SMA 50 and SMA 200

These are average prices over time.

They help the app understand trend.

Very simply:

- above important averages can mean strength
- below them can mean weakness

### MACD

MACD helps check momentum.

Momentum means:

“Is the stock moving with strength, or is the move fading?”

### ATR

ATR measures volatility.

Volatility means how wildly price moves.

The app uses ATR to decide:

- stop-loss distance
- targets
- trailing stop movement

### Stop-Loss

A stop-loss is your safety exit.

It says:

**“If price falls too much, get out and protect capital.”**

### Target

A target is a planned profit-taking level.

It says:

**“If price reaches here, book some or all profit.”**

### Trailing Stop-Loss

A trailing stop moves upward when a trade goes in your favor.

This helps:

- lock in profits
- reduce the chance of turning a winner into a loser

### Partial Profit Booking

This means selling only part of a position first.

Example:

- you bought 10 shares
- price reaches target
- the app sells 5 shares
- the other 5 shares keep running

This balances safety and upside.

### Drawdown

Drawdown means how much your account fell from its highest point.

Example:

- account goes from ₹50,000 to ₹55,000
- then falls to ₹51,000

That fall from the top is drawdown.

This matters because a system is not only about profit.
It is also about how painful the losses are on the way.

## Advanced Features In This Version

### Backtesting Engine

The app can now test strategies on 1 to 3 years of OHLCV data.

OHLCV means:

- Open
- High
- Low
- Close
- Volume

The backtest engine:

- reads old candles
- checks entry rules
- simulates buying
- manages stop-loss and target
- handles trailing stop
- handles partial exits
- respects capital limits
- creates a full trade log

It also avoids **lookahead bias**.

Lookahead bias means cheating by using future data that would not have been known at that time.

This app avoids that by moving one candle at a time.

### Strategy Filtering and Optimization

The app checks how each strategy style has performed.

If a strategy is doing badly, it can be weakened or blocked.

If a strategy is doing well, it can be given more importance.

It does things like:

- disable strategies with poor win rate and negative profit
- boost stronger strategies
- change score threshold by strategy
- give more capital to stronger strategies

### Smart Exit Logic

The app does not exit only because target or stop-loss is hit.

It also watches for weakness after entry.

It can exit when:

- RSI drops below 45
- trend weakens
- volume becomes weak
- ATR trailing stop is hit

This makes exits more intelligent.

### Capital Scaling

The app changes risk based on account condition.

It uses risk tiers:

- `Conservative` = 0.5%
- `Normal` = 1%
- `Aggressive` = 1.5%

If the system is doing badly or drawdown is high, risk can be reduced.
If the system is doing well, risk can be increased carefully.

### Performance Dashboard

The dashboard shows charts so you can understand the system better.

It includes:

- equity curve
- drawdown curve
- strategy performance
- sector performance
- risk-reward distribution
- best strategy
- worst strategy

## What Happens When You Click "Run Strategy Now"

When you click that button, the app roughly does this:

1. loads stock data
2. calculates indicators
3. scores each stock
4. saves signals
5. checks open trades
6. updates trailing stop-loss
7. books partial profit if needed
8. exits weak trades
9. opens new trades if conditions are good

So one click can update the whole paper trading system.

## What Happens When You Run A Backtest

When you run a backtest, the app:

1. loads historical stock candles
2. starts with a fixed capital amount
3. checks each candle one by one
4. decides if a trade should open
5. sizes the trade based on risk
6. manages the trade using stops and exits
7. tracks account growth over time
8. stores the results in Supabase

That is how the app creates the backtest charts.

## Database Tables In Easy Language

The app uses Supabase to save data.

Important tables:

### `signals`

Stores the latest stock signals.

### `trades`

Stores paper trades.

Includes:

- buy price
- sell price
- quantity
- profit/loss
- stop-loss
- target
- strategy info

### `wallet`

Stores your virtual money balance.

### `ledger`

Stores money movement records like deposits and withdrawals.

### `strategy_performance`

Stores how well each strategy style is performing.

### `backtest_runs`

Stores summary of each backtest.

### `backtest_trades`

Stores every simulated trade from a backtest.

## Project Structure

### `app/`

This is the frontend and API area.

- `app/page.tsx` = main page
- `app/components/` = UI pieces
- `app/api/` = backend routes

### `lib/`

This is where the trading logic lives.

- `indicators.ts` = math for RSI, SMA, MACD, ATR, and more
- `strategy.ts` = signal analysis logic
- `wallet.ts` = paper trade execution logic
- `supabase.ts` = database types and connection
- `lib/trading/` = backtesting, risk, performance, market data modules

### `supabase/schema.sql`

This is the SQL schema used to create tables.

## Tech Stack

This app is built with:

- `Next.js` for frontend and API routes
- `React` for UI
- `TypeScript` for safer code
- `Supabase` for database
- `Chart.js` for charts

## Why This App Is Useful

This app is useful if you want to learn:

- how trading systems are built
- how strategies are tested
- why risk management matters
- why profit alone is not enough
- how dashboards help understand data

It teaches an important lesson:

**A good trading system is not just about finding winners. It is about controlling losers, managing capital, and learning from data.**

## Important Warning

This app is for:

- education
- simulation
- testing

This app is **not financial advice**.

Real markets are risky.
Even a smart-looking system can lose money.
Always be careful with real capital.
