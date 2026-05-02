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



ALTER TABLE trades ADD COLUMN IF NOT EXISTS entry_type text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS market_condition text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS volume_strength text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_reward numeric(10, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_weight numeric(8, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_tier text;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS partial_exit_count integer DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS initial_stop_loss numeric(12, 2);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS highest_price numeric(12, 2);
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

CREATE POLICY "anon_full_signals"     ON signals     FOR ALL USING (true);
CREATE POLICY "anon_full_trades"      ON trades      FOR ALL USING (true);
CREATE POLICY "anon_full_wallet"      ON wallet      FOR ALL USING (true);
CREATE POLICY "anon_full_daily_stats" ON daily_stats FOR ALL USING (true);
CREATE POLICY "anon_full_ledger"      ON ledger      FOR ALL USING (true);
CREATE POLICY "anon_full_market_news" ON market_news FOR ALL USING (true);

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
