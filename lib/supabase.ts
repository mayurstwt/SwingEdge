import { createClient } from "@supabase/supabase-js";

// Environment variables (must be set in Netlify dashboard)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ================================
// 🌐 CLIENT-SIDE CLIENT (safe for browser)
// ================================
export function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or Anon Key. Check your .env file.");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false, // Serverless-friendly
    },
  });
}

// ================================
// 🔒 SERVER-ONLY CLIENT (admin privileges)
// ================================
export function getSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase URL or Service Role Key.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// ================================
// 📦 EXPORT: Backward-compatible admin instance
// ================================
export const supabase = getSupabaseAdmin();

// ================================
// 📋 DATABASE TYPES (match your schema.sql)
// ================================

export interface SignalRow {
  id: string;
  symbol: string;
  short_name?: string;
  decision: 'BUY' | 'HOLD' | 'AVOID';
  score: number;
  confidence: number;
  price: number;
  stop_loss: number;
  target: number;
  rsi?: number;
  trend?: string;
  change_pct?: number;
  reason?: string;
  signals?: string[];
  run_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface TradeRow {
  id: string;
  symbol: string;
  short_name?: string;
  buy_price: number;
  sell_price?: number | null;
  quantity: number;
  charges: number;
  stop_loss?: number;
  target?: number;
  status: 'OPEN' | 'CLOSED';
  direction?: 'LONG' | 'SHORT';
  executed_by?: 'MANUAL' | 'AUTO';
  reason?: string;
  strategy_version?: string;
  sector?: string;
  entry_type?: string;
  market_condition?: string;
  volume_strength?: string;
  risk_reward?: number;
  strategy_weight?: number;
  risk_tier?: string;
  partial_exit_count?: number;
  initial_stop_loss?: number;
  highest_price?: number;
  entry_score?: number;
  pnl?: number;
  profit_loss?: number;
  opened_at: string;
  closed_at?: string | null;
  created_at?: string;
}

export interface LedgerRow {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description?: string;
  created_at: string;
}

export interface WalletRow {
  id: number;
  balance: number;
  updated_at: string;
}

export interface DailyStatsRow {
  id: string;
  run_date: string;
  starting_balance: number;
  starting_equity: number;
  is_circuit_broken: boolean;
  created_at: string;
}

// ================================
// 🔧 TYPE-SAFE TABLE HELPERS
// ================================

export type Tables = {
  signals: SignalRow;
  trades: TradeRow;
  ledger: LedgerRow;
  wallet: WalletRow;
  daily_stats: DailyStatsRow;
};

// Helper for type-safe queries
export function fromTable<T extends keyof Tables>(
  client: ReturnType<typeof getSupabaseAdmin>,
  table: T
) {
  return client.from(table);
}