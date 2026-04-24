import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client (frontend-safe)
export function getSupabase() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Admin (server only)
export function getSupabaseAdmin() {
  return createClient(supabaseUrl, serviceRoleKey);
}

// ✅ ADD THIS (fixes your error)
export const supabase = getSupabaseAdmin();