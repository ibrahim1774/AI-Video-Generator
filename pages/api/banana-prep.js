import { createBananaPrep } from '../../lib/replicate';
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

/**
 * Stage-1 endpoint: compose the user's reference character into the
 * source video's first frame using Nano Banana Pro. A successful
 * Banana call consumes **one** of the user's entitlement slots \u2014
 * that's how we enforce "upload once, stick with it". Proceed/Kling
 * runs afterwards are free (the slot was already claimed here), and
 * Banana API failures don't count.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let entitlement;
  try {
    entitlement = await getEntitlement(req);
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

  console.log('[banana-prep] running', { firstFrameUrl, referenceImageUrl, mode });

  try {
    const hybridFrameUrl = await createBananaPrep({
      firstFrameUrl,
      referenceImageUrl,
      swapMode: mode,
    });
    if (!hybridFrameUrl) {
      throw new Error('Nano Banana Pro returned no image.');
    }
    console.log('[banana-prep] ok', { hybridFrameUrl });

    // One credit is consumed ONLY on successful Banana generation.
    try {
      await decrementCredits(req, res, entitlement);
    } catch (e) {
      console.warn('[banana-prep] credit decrement failed', e?.message);
    }

    return res.status(200).json({ hybridFrameUrl });
  } catch (err) {
    console.error('[banana-prep] failed', err);
    return res.status(500).json({ error: err.message || 'Hybrid frame generation failed.' });
  }
}
