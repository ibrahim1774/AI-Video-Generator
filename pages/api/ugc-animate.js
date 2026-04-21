import { createVeoLitePrediction, VEO_ALLOWED_DURATIONS } from '../../lib/replicate';
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

function snapDuration(d) {
  const n = Math.round(Number(d));
  if (VEO_ALLOWED_DURATIONS.includes(n)) return n;
  if (!Number.isFinite(n)) return 6;
  if (n <= 4) return 4;
  if (n <= 6) return 6;
  return 8;
}

// 1 credit per 3 seconds of video, rounded up. Min 1.
function costForSeconds(total) {
  return Math.max(1, Math.ceil(total / 3));
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

  const q = mode === 'pro' ? 'pro' : 'std';
  const dur = q === 'pro' ? 8 : snapDuration(duration);
  const cost = costForSeconds(dur);

  let entitlement;
  try {
    entitlement = await getEntitlement({ supabase: session.supabase, userId: session.user.id, email: session.user.email });
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
    const prediction = await createVeoLitePrediction({
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
