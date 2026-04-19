import { createBananaPrep } from '../../lib/replicate';
import { getEntitlement } from '../../lib/entitlement';

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
 * source video's first frame using Nano Banana Pro. Does NOT
 * increment the user's swap usage \u2014 the swap counter ticks only when
 * the user clicks Proceed and we run Kling.
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
      videosUsed: entitlement.videosUsed,
      videoCap: entitlement.videoCap,
      expired: entitlement.expired || false,
    });
  }

  const { firstFrameUrl, referenceImageUrl } = req.body || {};
  if (!isHttpUrl(firstFrameUrl) || !isHttpUrl(referenceImageUrl)) {
    return res.status(400).json({
      error: 'firstFrameUrl and referenceImageUrl are required (http/https URLs).',
    });
  }

  console.log('[banana-prep] running', { firstFrameUrl, referenceImageUrl });

  try {
    const hybridFrameUrl = await createBananaPrep({ firstFrameUrl, referenceImageUrl });
    if (!hybridFrameUrl) {
      throw new Error('Nano Banana Pro returned no image.');
    }
    console.log('[banana-prep] ok', { hybridFrameUrl });
    return res.status(200).json({ hybridFrameUrl });
  } catch (err) {
    console.error('[banana-prep] failed', err);
    return res.status(500).json({ error: err.message || 'Hybrid frame generation failed.' });
  }
}
