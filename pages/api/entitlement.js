import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement } from '../../lib/entitlement';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const session = await getUserFromRequest(req, res);
  if (!session) {
    return res.status(200).json({
      tier: 'none',
      videosUsed: 0,
      videoCap: 0,
      creditsRemaining: 0,
      canSwap: false,
    });
  }
  try {
    const ent = await getEntitlement({ supabase: session.supabase, userId: session.user.id });
    return res.status(200).json(ent);
  } catch (err) {
    return res.status(200).json({
      tier: 'none',
      videosUsed: 0,
      videoCap: 0,
      creditsRemaining: 0,
      canSwap: false,
      error: err.message,
    });
  }
}
