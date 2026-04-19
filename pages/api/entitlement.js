import { getEntitlement } from '../../lib/entitlement';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const ent = await getEntitlement(req);
    return res.status(200).json(ent);
  } catch (err) {
    return res.status(200).json({
      tier: 'none',
      videosUsed: 0,
      videoCap: 0,
      canSwap: false,
      error: err.message,
    });
  }
}
