import { createBrowserClient } from '@supabase/ssr';

/*
 * Browser Supabase client. Reads session from cookies automatically.
 *
 * Returns `null` if the env vars aren't set (e.g. before the user
 * pastes them into Vercel). Callers check for null so the app still
 * renders in an "anonymous, no auth available" state rather than
 * crashing with a client-side exception.
 */

let cached = null;
let warned = false;

export function getBrowserSupabase() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    if (!warned && typeof window !== 'undefined') {
      console.warn(
        '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set — auth disabled.'
      );
      warned = true;
    }
    return null;
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
