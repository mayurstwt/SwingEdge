import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SignalRow {
  id: string;
  symbol: string;
  short_name: string | null;
  decision: 'BUY' | 'HOLD' | 'AVOID';
  score: number;
  confidence: number;
  price: number;
  stop_loss: number;
  target: number;
  rsi: number;
  trend: string;
  change_pct: number;
  reason: string | null;
  run_date: string;
  created_at: string;
}

export interface TradeRow {
  id: string;
  symbol: string;
  short_name: string | null;
  buy_price: number;
  sell_price: number | null;
  quantity: number;
  charges: number; 
  stop_loss: number | null;
  target: number | null;
  status: 'OPEN' | 'CLOSED';
  executed_by: 'MANUAL' | 'AUTO';
  reason: string | null;
  strategy_version: string | null;
  sector: string | null;
  entry_type: string | null;
  market_condition: string | null;
  volume_strength: string | null;
  risk_reward: number | null;
  strategy_weight: number | null;
  risk_tier: string | null;
  partial_exit_count: number | null;
  initial_stop_loss: number | null;
  highest_price: number | null;
  entry_score: number | null;
  profit_loss: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface DailyStatsRow {
  id: string;
  run_date: string;
  starting_balance: number;
  starting_equity: number;
  is_circuit_broken: boolean;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  created_at: string;
}

export interface WalletRow {
  id: number;
  balance: number;
  updated_at: string;
}

export interface BacktestRunRow {
  id: string;
  name: string | null;
  request_hash: string;
  symbols: string[];
  start_date: string | null;
  end_date: string | null;
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate: number;
  avg_risk_reward: number;
  total_trades: number;
  settings: Record<string, unknown>;
  equity_curve: Array<Record<string, unknown>>;
  drawdown_curve: Array<Record<string, unknown>>;
  created_at: string;
}

export interface BacktestTradeRow {
  id: string;
  run_id: string;
  symbol: string;
  short_name: string | null;
  sector: string | null;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pnl: number;
  net_pnl: number;
  exit_reason: string;
  entry_type: string | null;
  risk_reward: number | null;
  partial_exit_count: number;
  bars_held: number;
  strategy_score: number | null;
  risk_tier: string | null;
  created_at: string;
}

export interface StrategyPerformanceRow {
  entry_type: string;
  avg_profit: number;
  win_rate: number;
  trades_count: number;
  total_profit: number;
  dynamic_score_threshold: number;
  capital_weight: number;
  enabled: boolean;
  updated_at: string;
}

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !key) {
    throw new Error('Supabase credentials missing in env.');
  }
  _supabase = createClient(url, key);
  return _supabase;
}
