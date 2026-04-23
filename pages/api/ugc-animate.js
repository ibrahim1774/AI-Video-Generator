import {
  createKlingSinglePrediction,
  createKlingStoryboardPrediction,
} from '../../lib/kie';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement, reserveCredits, refundCredits } from '../../lib/entitlement';
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

function clampSceneDuration(d) {
  const n = Math.round(Number(d));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(12, n));
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

  const { imageUrl, script, mode, duration, audio, scenes } = req.body || {};
  if (!isHttpUrl(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl is required (http/https URL).' });
  }

  const isStoryboard = Array.isArray(scenes) && scenes.length > 0;
  const q = mode === 'pro' ? 'pro' : 'std';
  const wantAudio = audio !== false;

  let totalSeconds;
  let normalizedScenes = null;
  if (isStoryboard) {
    if (scenes.length > 5) {
      return res.status(400).json({ error: 'Storyboard supports up to 5 scenes.' });
    }
    normalizedScenes = scenes.map((s) => ({
      prompt: typeof s?.prompt === 'string' ? s.prompt : '',
      duration: clampSceneDuration(s?.duration),
    }));
    totalSeconds = normalizedScenes.reduce((a, s) => a + s.duration, 0);
  } else {
    totalSeconds = clampDuration(duration);
  }

  const cost = costForSeconds(totalSeconds);

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
    let prediction;
    if (isStoryboard) {
      prediction = await createKlingStoryboardPrediction({
        imageUrl,
        scenes: normalizedScenes,
        mode: q,
        audio: wantAudio,
      });
    } else {
      prediction = await createKlingSinglePrediction({
        imageUrl,
        prompt: script || '',
        duration: totalSeconds,
        mode: q,
        audio: wantAudio,
      });
    }
    sendCapiEvent({
      eventName: 'Generate',
      eventId: `gen-${prediction.id}`,
      value: cost,
      currency: 'USD',
      email: session.user.email,
      req,
      customData: {
        feature: isStoryboard ? 'ugc-storyboard' : 'ugc-animate',
        credits: cost,
        duration: totalSeconds,
        scenes: isStoryboard ? normalizedScenes.length : 1,
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
    console.error('[ugc-animate] failed; refunding credits', err);
    try { await refundCredits(entitlement, cost); } catch {}
    return res.status(500).json({ error: err.message || 'UGC animation failed.' });
  }
}
