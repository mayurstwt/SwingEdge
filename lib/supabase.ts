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
  status: 'OPEN' | 'CLOSED';
  profit_loss: number | null;
  opened_at: string;
  closed_at: string | null;
}

export interface WalletRow {
  id: number;
  balance: number;
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
