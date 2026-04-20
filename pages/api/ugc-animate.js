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

// Cost rule: 1 credit per 3 seconds, rounded up. The model outputs
// only 5 or 10 second videos, so the practical mapping is
// 5s = 2 credits and 10s = 4 credits.
function costFor(duration) {
  return Math.ceil(duration / 3);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { imageUrl, script, mode, duration } = req.body || {};
  if (!isHttpUrl(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl is required (http/https URL).' });
  }
  const dur = ALLOWED_DURATIONS.includes(Number(duration)) ? Number(duration) : 5;
  const q = mode === 'pro' ? 'pro' : 'std';
  const cost = costFor(dur);

  let entitlement;
  try {
    entitlement = await getEntitlement({ supabase: session.supabase, userId: session.user.id });
  } catch (err) {
    return res.status(500).json({ error: `Entitlement check failed: ${err.message}` });
  }

  try {
    await reserveCredits(entitlement, cost);
  } catch (err) {
    if (err.code === 'INSUFFICIENT' || err.code === 'NO_PLAN') {
      return res.status(402).json({
        error: 'paywall',
        tier: entitlement.tier,
        creditsRemaining: err.remaining ?? entitlement.creditsRemaining ?? 0,
        cost,
      });
    }
    return res.status(500).json({ error: err.message });
  }

  try {
    const prediction = await createImageToVideoPrediction({
      imageUrl,
      prompt: script || '',
      duration: dur,
      mode: q,
    });
    return res.status(200).json({
      predictionId: prediction.id,
      status: prediction.status,
      cost,
    });
  } catch (err) {
    console.error('[ugc-animate] failed; refunding credits', err);
    try { await refundCredits(entitlement, cost); } catch {}
    return res.status(500).json({ error: err.message || 'UGC animation failed.' });
  }
}
