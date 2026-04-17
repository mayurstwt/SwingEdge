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

CREATE TABLE IF NOT EXISTS strategy_performance (
  entry_type               text PRIMARY KEY,
  avg_profit               numeric(14, 2) DEFAULT 0.00,
  win_rate                 numeric(6, 2) DEFAULT 0.00,
  trades_count             integer DEFAULT 0,
  total_profit             numeric(14, 2) DEFAULT 0.00,
  dynamic_score_threshold  integer DEFAULT 70,
  capital_weight           numeric(8, 2) DEFAULT 1.00,
  enabled                  boolean DEFAULT true,
  updated_at               timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name              text,
  request_hash      text NOT NULL UNIQUE,
  symbols           text[] NOT NULL,
  start_date        date,
  end_date          date,
  initial_capital   numeric(14, 2) NOT NULL,
  final_equity      numeric(14, 2) NOT NULL,
  total_return_pct  numeric(8, 2) NOT NULL,
  max_drawdown_pct  numeric(8, 2) NOT NULL,
  win_rate          numeric(8, 2) NOT NULL,
  avg_risk_reward   numeric(8, 2) NOT NULL,
  total_trades      integer NOT NULL,
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  equity_curve      jsonb NOT NULL DEFAULT '[]'::jsonb,
  drawdown_curve    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id              uuid NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  symbol              text NOT NULL,
  short_name          text,
  sector              text,
  entry_date          date NOT NULL,
  exit_date           date NOT NULL,
  entry_price         numeric(12, 2) NOT NULL,
  exit_price          numeric(12, 2) NOT NULL,
  quantity            integer NOT NULL,
  gross_pnl           numeric(14, 2) NOT NULL,
  net_pnl             numeric(14, 2) NOT NULL,
  exit_reason         text NOT NULL,
  entry_type          text,
  risk_reward         numeric(10, 2),
  partial_exit_count  integer DEFAULT 0,
  bars_held           integer DEFAULT 0,
  strategy_score      integer,
  risk_tier           text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backtest_runs_created_at_idx ON backtest_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS backtest_trades_run_id_idx ON backtest_trades(run_id);

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
ALTER TABLE strategy_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_signals"     ON signals     FOR ALL USING (true);
CREATE POLICY "anon_full_trades"      ON trades      FOR ALL USING (true);
CREATE POLICY "anon_full_wallet"      ON wallet      FOR ALL USING (true);
CREATE POLICY "anon_full_daily_stats" ON daily_stats FOR ALL USING (true);
CREATE POLICY "anon_full_ledger"      ON ledger      FOR ALL USING (true);
CREATE POLICY "anon_full_strategy_performance" ON strategy_performance FOR ALL USING (true);
CREATE POLICY "anon_full_backtest_runs" ON backtest_runs FOR ALL USING (true);
CREATE POLICY "anon_full_backtest_trades" ON backtest_trades FOR ALL USING (true);
