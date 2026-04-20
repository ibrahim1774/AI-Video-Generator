import { createServerClient } from '@supabase/ssr';
import { parse, serialize } from 'cookie';

/*
 * Server Supabase client bound to a Next.js Pages API req/res pair.
 * Reads + writes the auth cookies set by @supabase/ssr so session
 * refresh works automatically.
 */

export function createSupabaseServer(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase env vars missing on server.');
  }

  return createServerClient(url, anonKey, {
    cookies: {
      get(name) {
        const cookies = parse(req.headers?.cookie || '');
        return cookies[name];
      },
      set(name, value, options) {
        if (!res) return;
        res.setHeader('Set-Cookie', serialize(name, value, { path: '/', ...options }));
      },
      remove(name, options) {
        if (!res) return;
        res.setHeader(
          'Set-Cookie',
          serialize(name, '', { path: '/', ...options, maxAge: 0 })
        );
      },
    },
  });
}

/**
 * Service-role Supabase client. Bypasses RLS — only use from server
 * routes for tightly-scoped writes (e.g. recording sign-up IPs).
 */
import { createClient } from '@supabase/supabase-js';
let adminCached = null;
export function getSupabaseAdmin() {
  if (adminCached) return adminCached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Service-role Supabase client requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  adminCached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminCached;
}

/**
 * Convenience helper used at the top of every protected API route.
 * Returns { user, supabase } or null if not authenticated.
 */
export async function getUserFromRequest(req, res) {
  const supabase = createSupabaseServer(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase };
}
