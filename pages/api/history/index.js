import { getUserFromRequest, getSupabaseAdmin } from '../../../lib/supabaseServer';

/*
 * GET /api/history → { items: [...] }
 *
 * Returns the signed-in user's non-expired video history rows,
 * newest first.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('videos')
      .select('id, kind, result_url, created_at, expires_at')
      .eq('user_id', session.user.id)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[history] supabase error', error.message);
      return res.status(500).json({ error: 'Could not load history.' });
    }
    return res.status(200).json({ items: data || [] });
  } catch (err) {
    console.error('[history] threw', err);
    return res.status(500).json({ error: err.message || 'History lookup failed.' });
  }
}
