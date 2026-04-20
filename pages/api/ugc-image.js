import { createImage } from '../../lib/replicate';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement, reserveCredits, refundCredits } from '../../lib/entitlement';

const COST = 1;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  let entitlement;
  try {
    entitlement = await getEntitlement({ supabase: session.supabase, userId: session.user.id });
  } catch (err) {
    return res.status(500).json({ error: `Entitlement check failed: ${err.message}` });
  }

  const { prompt } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  try {
    await reserveCredits(entitlement, COST);
  } catch (err) {
    if (err.code === 'INSUFFICIENT' || err.code === 'NO_PLAN') {
      return res.status(402).json({
        error: 'paywall',
        tier: entitlement.tier,
        creditsRemaining: err.remaining ?? entitlement.creditsRemaining ?? 0,
        cost: COST,
      });
    }
    return res.status(500).json({ error: err.message });
  }

  try {
    const imageUrl = await createImage({ prompt });
    if (!imageUrl) throw new Error('Image generation returned no result.');
    return res.status(200).json({ imageUrl });
  } catch (err) {
    console.error('[ugc-image] failed; refunding credit', err);
    try { await refundCredits(entitlement, COST); } catch {}
    return res.status(500).json({ error: err.message || 'Image generation failed.' });
  }
}
