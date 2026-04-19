import { setDevCookie } from '../../lib/entitlement';

/*
 * Sets the ff_dev cookie giving unlimited swaps for testing.
 * REMOVE this route + the COOKIES.dev branch in lib/entitlement.js
 * before going public.
 */
export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  setDevCookie(res);
  return res.status(200).json({ ok: true, tier: 'dev' });
}
