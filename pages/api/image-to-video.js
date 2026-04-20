import { createImageToVideoPrediction, ALLOWED_DURATIONS } from '../../lib/replicate';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement, reserveCredits, refundCredits } from '../../lib/entitlement';

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

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

  const { imageUrl, prompt, mode, duration } = req.body || {};
  if (!isHttpUrl(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl is required (http/https URL).' });
  }
  const dur = ALLOWED_DURATIONS.includes(Number(duration)) ? Number(duration) : 5;
  const q = mode === 'pro' ? 'pro' : 'std';

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
    const prediction = await createImageToVideoPrediction({
      imageUrl,
      prompt: prompt || '',
      duration: dur,
      mode: q,
    });
    return res.status(200).json({
      predictionId: prediction.id,
      status: prediction.status,
    });
  } catch (err) {
    console.error('[image-to-video] failed; refunding credit', err);
    try { await refundCredits(entitlement, COST); } catch {}
    return res.status(500).json({ error: err.message || 'Image-to-video failed.' });
  }
}
