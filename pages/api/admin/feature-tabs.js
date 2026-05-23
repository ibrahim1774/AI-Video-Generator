import { getUserFromRequest } from '../../../lib/supabaseServer';
import { getFeatureTabsEnabled, setFeatureTabsEnabled } from '../../../lib/featureFlags';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'ibrahim3709@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function handler(req, res) {
  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const email = (session.user.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Admin only.' });
  }

  if (req.method === 'GET') {
    const enabled = await getFeatureTabsEnabled();
    return res.status(200).json({ enabled });
  }

  if (req.method === 'POST') {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Body must be { enabled: boolean }.' });
    }
    try {
      const value = await setFeatureTabsEnabled(enabled);
      return res.status(200).json({ enabled: value });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
