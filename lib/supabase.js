import { createBrowserClient } from '@supabase/ssr';

/*
 * Browser Supabase client. Reads session from cookies automatically.
 * Uses the anon (public) key \u2014 Row-Level Security in Postgres is
 * what protects user data, not key secrecy.
 */

let cached = null;
export function getBrowserSupabase() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from env.'
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
