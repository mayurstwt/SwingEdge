-- =============================================
-- SwingEdge — Supabase Schema (Enhanced V3 - Professional)
-- =============================================

-- 1. Daily signals table (Added 'reason' column)
CREATE TABLE IF NOT EXISTS signals (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol      text NOT NULL,
  short_name  text,
  decision    text NOT NULL CHECK (decision IN ('BUY', 'HOLD', 'AVOID')),
  score       integer,
  confidence  integer,
  price       numeric(12, 2),
  stop_loss   numeric(12, 2),
  target      numeric(12, 2),
  rsi         numeric(6, 2),
  trend       text,
  change_pct  numeric(6, 2),
  reason      text,
    run_date    date NOT NULL DEFAULT CURRENT_DATE,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
 );

CREATE INDEX IF NOT EXISTS signals_run_date_idx ON signals(run_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS signals_symbol_run_date_idx ON signals(symbol, run_date);

-- 2. Paper trades table (Added 'reason', 'version', 'sector')
CREATE TABLE IF NOT EXISTS trades (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol           text NOT NULL,
  short_name       text,
  buy_price        numeric(12, 2) NOT NULL,
  sell_price       numeric(12, 2),
  quantity         integer DEFAULT 1,
  charges          numeric(12, 2) DEFAULT 0.00,
  stop_loss        numeric(12, 2),
  target           numeric(12, 2),
  status           text DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  direction        text DEFAULT 'LONG' CHECK (direction IN ('LONG', 'SHORT')),
  executed_by      text DEFAULT 'MANUAL' CHECK (executed_by IN ('MANUAL', 'AUTO')),
  reason           text,
  strategy_version text,
  sector           text,
  entry_type       text,
  market_condition text,
  volume_strength  text,
  risk_reward      numeric(10, 2),
  strategy_weight  numeric(8, 2),
  risk_tier        text,
  partial_exit_count integer DEFAULT 0,
  initial_stop_loss numeric(12, 2),
  highest_price    numeric(12, 2),
  entry_score      integer,
  pnl              numeric(12, 2),
  profit_loss      numeric(12, 2),
  opened_at        timestamptz DEFAULT now(),
  closed_at        timestamptz
);

-- 3. Paper wallet table
CREATE TABLE IF NOT EXISTS wallet (
  id          integer PRIMARY KEY DEFAULT 1,
  balance     numeric(14, 2) DEFAULT 0.00,
  updated_at  timestamptz DEFAULT now()
);

-- 4. Daily stats table (Drawdown tracking)
CREATE TABLE IF NOT EXISTS daily_stats (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date          date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  starting_balance  numeric(14, 2),
  starting_equity   numeric(14, 2),
  is_circuit_broken boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

-- 5. Ledger table (Track deposits/withdrawals)
CREATE TABLE IF NOT EXISTS ledger (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  amount      numeric(14, 2) NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- 6. Daily market news cache
CREATE TABLE IF NOT EXISTS market_news (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source          text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('MARKET', 'COMPANY')),
  title           text NOT NULL,
  summary         text,
  link            text NOT NULL,
  image_url       text,
  published_at    timestamptz,
  symbols         text[] DEFAULT '{}',
  fingerprint     text NOT NULL UNIQUE,
  relevance_score integer DEFAULT 0,
  synced_at       timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_news_published_idx ON market_news(published_at DESC);
CREATE INDEX IF NOT EXISTS market_news_source_type_idx ON market_news(source_type);
CREATE INDEX IF NOT EXISTS market_news_symbols_idx ON market_news USING GIN(symbols);

-- 7. Smart trade tips
CREATE TABLE IF NOT EXISTS trade_tips (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol          text NOT NULL,
  short_name      text,
  sector          text,
  tip_type        text NOT NULL CHECK (tip_type IN ('STRONG_BUY', 'MODERATE_BUY', 'WATCH')),
  composite_score integer NOT NULL,
  suggested_price numeric(12, 2) NOT NULL,
  suggested_qty   integer NOT NULL,
  stop_loss       numeric(12, 2),
  target          numeric(12, 2),
  risk_reward     numeric(6, 2),
  technical_score integer,
  market_context  integer,
  news_sentiment  integer,
  news_headlines  text[] DEFAULT '{}',
  reasoning       text NOT NULL,
  status          text DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED', 'EXPIRED', 'CANCELLED')),
  triggered_at    timestamptz,
  triggered_price numeric(12, 2),
  user_action     text CHECK (user_action IN ('BUY', 'IGNORE', 'EXPIRED')),
  run_id          uuid,
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz,
  notified        boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS trade_tips_status_idx ON trade_tips(status);
CREATE INDEX IF NOT EXISTS trade_tips_symbol_idx ON trade_tips(symbol);
CREATE INDEX IF NOT EXISTS trade_tips_created_idx ON trade_tips(created_at DESC);



ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_type text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS direction text DEFAULT 'LONG' CHECK (direction IN ('LONG', 'SHORT'));
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_condition text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volume_strength text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_reward numeric(10, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_weight numeric(8, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_tier text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS partial_exit_count integer DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS initial_stop_loss numeric(12, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS highest_price numeric(12, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS pnl numeric(12, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_score integer;

-- Seed current wallet if missing
INSERT INTO wallet (id, balance) VALUES (1, 0.00)
ON CONFLICT (id) DO NOTHING;

-- Policies
ALTER TABLE signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_news  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_tips  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_signals"     ON signals     FOR ALL USING (true);
CREATE POLICY "anon_full_trades"      ON trades      FOR ALL USING (true);
CREATE POLICY "anon_full_wallet"      ON wallet      FOR ALL USING (true);
CREATE POLICY "anon_full_daily_stats" ON daily_stats FOR ALL USING (true);
CREATE POLICY "anon_full_ledger"      ON ledger      FOR ALL USING (true);
CREATE POLICY "anon_full_market_news" ON market_news FOR ALL USING (true);
CREATE POLICY "anon_full_trade_tips"  ON trade_tips  FOR ALL USING (true);

-- Strategy execution audit table
CREATE TABLE IF NOT EXISTS strategy_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_key text UNIQUE NOT NULL,
  run_timestamp timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' 
    CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  error_message text,
  trades_opened integer DEFAULT 0,
  trades_closed integer DEFAULT 0,
  market_conditions jsonb,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  log_summary text
);

CREATE INDEX IF NOT EXISTS strategy_runs_started_at_idx ON strategy_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS strategy_runs_status_idx ON strategy_runs(status);
CREATE INDEX IF NOT EXISTS strategy_runs_run_key_idx ON strategy_runs(run_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'trade_tips_run_id_fkey'
      AND table_name = 'trade_tips'
  ) THEN
    ALTER TABLE trade_tips
      ADD CONSTRAINT trade_tips_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES strategy_runs(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Enable RLS
ALTER TABLE strategy_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_strategy_runs" ON strategy_runs FOR ALL USING (true);

-- Trade logs table
CREATE TABLE IF NOT EXISTS trade_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_run_id uuid REFERENCES strategy_runs(id) ON DELETE CASCADE,
  level text CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  message text NOT NULL,
  symbol text,
  action text,
  score integer,
  reason text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trade_logs_strategy_run_idx ON trade_logs(strategy_run_id);
CREATE INDEX IF NOT EXISTS trade_logs_level_idx ON trade_logs(level);
CREATE INDEX IF NOT EXISTS trade_logs_created_at_idx ON trade_logs(created_at DESC);

-- =============================================
-- 7. SUPABASE CRON (Automation Trigger)
-- =============================================
-- Enable extensions (Must be done by an admin/dashboard)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- UNCOMMENT AND RUN IN SUPABASE SQL EDITOR AFTER SETTING YOUR_APP_URL AND YOUR_CRON_SECRET
-- Every 5 minutes during NSE market hours (approx 9:15 AM - 3:30 PM IST)
-- 9:15 IST = 3:45 UTC; 3:30 IST = 10:00 UTC

SELECT cron.schedule(
  'run-strategy-every-5-min',
  '*/5 4-9 * * 1-5', -- Every 5 min from 4:00 AM to 9:55 AM UTC (Mon-Fri)
  $$
  SELECT net.http_post(
    url := 'https://YOUR_APP_URL.netlify.app/api/run-strategy',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    body := '{"bypassMarketFilter": false}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'run-strategy-market-open',
  '45 3 * * 1-5', -- NSE Market Open (9:15 AM IST)
  $$
  SELECT net.http_post(
    url := 'https://YOUR_APP_URL.netlify.app/api/run-strategy',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    body := '{"bypassMarketFilter": false}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'expire-trade-tips-daily',
  '30 22 * * *',
  $$
  UPDATE trade_tips
  SET
    status = 'EXPIRED',
    user_action = COALESCE(user_action, 'EXPIRED')
  WHERE status = 'ACTIVE'
    AND expires_at IS NOT NULL
    AND expires_at < now()
  $$
);

-- =============================================
-- 8. ATOMIC TRADE EXECUTION FUNCTION
-- =============================================
-- Executes a buy trade atomically:
--   1. Locks the wallet row (FOR UPDATE)
--   2. Validates balance and price levels
--   3. Inserts trade with OPEN status
--   4. Debits wallet balance
-- All steps run in a single transaction — no partial state possible.

CREATE OR REPLACE FUNCTION execute_trade_atomic(
  p_symbol       TEXT,
  p_quantity     INTEGER,
  p_buy_price    DECIMAL,
  p_stop_loss    DECIMAL,
  p_target       DECIMAL,
  p_short_name   TEXT    DEFAULT NULL,
  p_sector       TEXT    DEFAULT NULL,
  p_entry_score  INTEGER DEFAULT NULL
) RETURNS TABLE(
  trade_id          UUID,
  new_balance       DECIMAL,
  capital_committed DECIMAL
) AS $$
DECLARE
  v_wallet_balance DECIMAL;
  v_total_cost     DECIMAL;
  v_trade_id       UUID;
BEGIN
  -- Lock the single wallet row so concurrent calls cannot double-spend
  SELECT balance INTO v_wallet_balance
  FROM wallet
  WHERE id = 1
  FOR UPDATE;

  -- Ensure wallet exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  v_total_cost := p_quantity * p_buy_price;

  -- Validate sufficient balance
  IF v_wallet_balance < v_total_cost THEN
    RAISE EXCEPTION 'Insufficient balance: need %.2f, have %.2f',
      v_total_cost, v_wallet_balance;
  END IF;

  -- Validate stop loss is strictly below entry
  IF p_stop_loss >= p_buy_price THEN
    RAISE EXCEPTION 'Stop loss (%.2f) must be below entry price (%.2f)',
      p_stop_loss, p_buy_price;
  END IF;

  -- Validate target is strictly above entry
  IF p_target <= p_buy_price THEN
    RAISE EXCEPTION 'Target (%.2f) must be above entry price (%.2f)',
      p_target, p_buy_price;
  END IF;

  -- Insert trade
  INSERT INTO trades (
    symbol,
    short_name,
    sector,
    buy_price,
    stop_loss,
    target,
    initial_stop_loss,
    highest_price,
    quantity,
    direction,
    status,
    executed_by,
    entry_score,
    pnl,
    profit_loss,
    opened_at
  ) VALUES (
    p_symbol,
    p_short_name,
    p_sector,
    p_buy_price,
    p_stop_loss,
    p_target,
    p_stop_loss,
    p_buy_price,
    p_quantity,
    'LONG',
    'OPEN',
    'AUTO',
    p_entry_score,
    0,
    0,
    NOW()
  ) RETURNING id INTO v_trade_id;

  -- Debit wallet atomically
  UPDATE wallet
  SET
    balance    = balance - v_total_cost,
    updated_at = NOW()
  WHERE id = 1;

  -- Return results to the caller
  RETURN QUERY SELECT
    v_trade_id,
    (v_wallet_balance - v_total_cost)::DECIMAL,
    v_total_cost::DECIMAL;
END;
$$ LANGUAGE plpgsql;
