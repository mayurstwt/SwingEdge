import { createClient, SupabaseClient } from '@supabase/supabase-js';

/* ================= TYPES (UNCHANGED) ================= */

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

export interface WalletRow {
  id: number;
  balance: number;
  updated_at: string;
}

export interface LedgerRow {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string | null;
  created_at: string;
}

/* ================= CLIENT SETUP ================= */

let _supabasePublic: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

/**
 * 🔹 PUBLIC CLIENT (for frontend use only)
 */
export function getSupabase(): SupabaseClient {
  if (_supabasePublic) return _supabasePublic;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url || !key) {
    throw new Error('❌ Public Supabase credentials missing');
  }

  _supabasePublic = createClient(url, key);
  return _supabasePublic;
}

/**
 * 🔥 ADMIN CLIENT (for backend / API routes)
 * Bypasses RLS → REQUIRED for trades + wallet writes in production.
 *
 * If SUPABASE_SERVICE_ROLE_KEY is not set (e.g. local dev without .env.local),
 * falls back to the anon key with a warning instead of throwing a 500.
 * Add SUPABASE_SERVICE_ROLE_KEY to your .env to get full write access.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!url) {
    throw new Error('❌ NEXT_PUBLIC_SUPABASE_URL is missing from .env');
  }

  if (!serviceKey) {
    // Graceful fallback: warn loudly but don't crash the whole API route.
    // Writes to RLS-protected tables will be rejected by Supabase, but reads will work.
    console.warn(
      '⚠️  SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Falling back to anon key — DB writes may be blocked by RLS. ' +
      'Add the service role key from Supabase Dashboard → Project Settings → API → service_role.'
    );
    return getSupabase();
  }

  _supabaseAdmin = createClient(url, serviceKey);
  return _supabaseAdmin;
}