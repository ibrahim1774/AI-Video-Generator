import { setTrialCookies } from '../../lib/entitlement';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  setTrialCookies(res, { startedAt: Date.now(), used: 0 });
  return res.status(200).json({ ok: true });
}
