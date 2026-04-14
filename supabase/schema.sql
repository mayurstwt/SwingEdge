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

-- Seed current wallet if missing
INSERT INTO wallet (id, balance) VALUES (1, 0.00)
ON CONFLICT (id) DO NOTHING;

-- Policies
ALTER TABLE signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_full_signals"     ON signals     FOR ALL USING (true);
CREATE POLICY "anon_full_trades"      ON trades      FOR ALL USING (true);
CREATE POLICY "anon_full_wallet"      ON wallet      FOR ALL USING (true);
CREATE POLICY "anon_full_daily_stats" ON daily_stats FOR ALL USING (true);
CREATE POLICY "anon_full_ledger"      ON ledger      FOR ALL USING (true);
