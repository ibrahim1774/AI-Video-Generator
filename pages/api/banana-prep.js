import { createBananaPrep } from '../../lib/replicate';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { getEntitlement, decrementCredits } from '../../lib/entitlement';

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
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
    entitlement = await getEntitlement({
      supabase: session.supabase,
      userId: session.user.id,
    });
  } catch (err) {
    return res.status(500).json({ error: `Entitlement check failed: ${err.message}` });
  }
  if (!entitlement.canSwap) {
    return res.status(402).json({
      error: 'paywall',
      tier: entitlement.tier,
      creditsRemaining: entitlement.creditsRemaining || 0,
      videosUsed: entitlement.videosUsed,
      videoCap: entitlement.videoCap,
      expired: entitlement.expired || false,
    });
  }

  const { firstFrameUrl, referenceImageUrl, swapMode } = req.body || {};
  if (!isHttpUrl(firstFrameUrl) || !isHttpUrl(referenceImageUrl)) {
    return res.status(400).json({
      error: 'firstFrameUrl and referenceImageUrl are required (http/https URLs).',
    });
  }
  const mode = swapMode === 'body' ? 'body' : swapMode === 'face' ? 'face' : null;
  if (!mode) {
    return res.status(400).json({ error: "swapMode must be 'face' or 'body'." });
  }

  console.log('[banana-prep] running', { userId: session.user.id, mode });

  try {
    const hybridFrameUrl = await createBananaPrep({
      firstFrameUrl,
      referenceImageUrl,
      swapMode: mode,
    });
    if (!hybridFrameUrl) throw new Error('Nano Banana Pro returned no image.');
    console.log('[banana-prep] ok', { hybridFrameUrl });

    try {
      await decrementCredits(entitlement);
    } catch (e) {
      console.warn('[banana-prep] credit decrement failed', e?.message);
    }

    return res.status(200).json({ hybridFrameUrl });
  } catch (err) {
    console.error('[banana-prep] failed', err);
    return res.status(500).json({ error: err.message || 'Hybrid frame generation failed.' });
  }
}
