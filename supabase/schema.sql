-- =============================================
-- SwingEdge — Supabase Schema (Enhanced)
-- Run this once in the Supabase SQL Editor
-- =============================================

-- 1. Daily signals table
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
  run_date    date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signals_run_date_idx ON signals(run_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS signals_symbol_run_date_idx ON signals(symbol, run_date);

-- 2. Paper trades table (Added 'charges' column)
CREATE TABLE IF NOT EXISTS trades (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol      text NOT NULL,
  short_name  text,
  buy_price   numeric(12, 2) NOT NULL,
  sell_price  numeric(12, 2),
  quantity    integer DEFAULT 1,
  charges     numeric(12, 2) DEFAULT 0.00,
  status      text DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  profit_loss numeric(12, 2),
  opened_at   timestamptz DEFAULT now(),
  closed_at   timestamptz
);

-- 3. Paper wallet table (Seed balance 0.00)
CREATE TABLE IF NOT EXISTS wallet (
  id          integer PRIMARY KEY DEFAULT 1,
  balance     numeric(14, 2) DEFAULT 0.00,
  updated_at  timestamptz DEFAULT now()
);

-- Seed current wallet if missing
INSERT INTO wallet (id, balance) VALUES (1, 0.00)
ON CONFLICT (id) DO NOTHING;

-- Policies (Public for dev convenience)
ALTER TABLE signals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_signals"  ON signals  FOR SELECT USING (true);
CREATE POLICY "anon_write_signals" ON signals  FOR ALL    USING (true);
CREATE POLICY "anon_read_trades"   ON trades   FOR SELECT USING (true);
CREATE POLICY "anon_write_trades"  ON trades   FOR ALL    USING (true);
CREATE POLICY "anon_read_wallet"   ON wallet   FOR SELECT USING (true);
CREATE POLICY "anon_write_wallet"  ON wallet   FOR ALL    USING (true);
