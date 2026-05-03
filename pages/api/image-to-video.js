import { createKlingSinglePrediction } from '../../lib/kie';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement, reserveCredits, refundCredits, trackPendingJob } from '../../lib/entitlement';
import { sendCapiEvent } from '../../lib/meta';

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function clampDuration(d) {
  const n = Math.round(Number(d));
  if (!Number.isFinite(n)) return 5;
  return Math.max(3, Math.min(15, n));
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

  let entitlement;
  try {
    entitlement = await getEntitlement({ supabase: session.supabase, userId: session.user.id, email: session.user.email });
  } catch (err) {
    return res.status(500).json({ error: `Entitlement check failed: ${err.message}` });
  }

  const { imageUrl, prompt, mode, duration, audio } = req.body || {};
  if (!isHttpUrl(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl is required (http/https URL).' });
  }
  const q = mode === 'pro' ? 'pro' : 'std';
  const dur = clampDuration(duration);
  const wantAudio = audio !== false;
  const cost = costForSeconds(dur);

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
    const prediction = await createKlingSinglePrediction({
      imageUrl,
      prompt: prompt || '',
      duration: dur,
      mode: q,
      audio: wantAudio,
    });
    // Track the queued job so /api/status can refund the cost if Kling
    // ultimately rejects it (e.g. content moderation). Best-effort —
    // a tracking failure must not block returning the predictionId.
    trackPendingJob(entitlement, prediction.id, cost).catch(() => {});
    sendCapiEvent({
      eventName: 'Generate',
      eventId: `gen-${prediction.id}`,
      value: cost,
      currency: 'USD',
      email: session.user.email,
      req,
      customData: {
        feature: 'image-to-video',
        credits: cost,
        duration: dur,
        quality: q,
        audio: wantAudio,
        supabase_user_id: session.user.id,
      },
    }).catch(() => {});
    return res.status(200).json({
      predictionId: prediction.id,
      vendor: 'kie',
      status: 'queued',
      cost,
    });
  } catch (err) {
    console.error('[image-to-video] failed; refunding credit', err);
    try { await refundCredits(entitlement, cost); } catch {}
    return res.status(500).json({ error: err.message || 'Image-to-video failed.' });
  }
}
