import { getFeatureTabsEnabled } from '../../lib/featureFlags';

// Public: the Navbar reads this for anonymous + signed-in visitors.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const enabled = await getFeatureTabsEnabled();
  res.setHeader('Cache-Control', 'public, max-age=30');
  return res.status(200).json({ enabled });
}
