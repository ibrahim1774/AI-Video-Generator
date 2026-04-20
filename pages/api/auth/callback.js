import { createSupabaseServer } from '../../../lib/supabaseServer';

/*
 * Google OAuth redirect handler. Supabase redirects back here with
 * a ?code=... query param; we exchange it for a session cookie and
 * push the user to /dashboard.
 */
export default async function handler(req, res) {
  const { code } = req.query;

  if (code) {
    try {
      const supabase = createSupabaseServer(req, res);
      await supabase.auth.exchangeCodeForSession(code);
    } catch (err) {
      console.error('[auth/callback] exchange failed', err.message);
      return res.redirect(302, '/sign-in?error=oauth_exchange_failed');
    }
  }

  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/')
    ? req.query.next
    : '/';
  return res.redirect(302, next);
}
