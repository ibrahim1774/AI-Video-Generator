import { createCharacterFrame } from '../../lib/replicate';
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
    entitlement = await getEntitlement({
      supabase: session.supabase,
      userId: session.user.id,
      email: session.user.email,
    });
  } catch (err) {
    return res.status(500).json({ error: `Entitlement check failed: ${err.message}` });
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

  // Reserve the credit BEFORE running the model. Closes the
  // double-spend race that an after-success decrement opens.
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

  console.log('[character-frame] running', { userId: session.user.id, mode });

  try {
    const hybridFrameUrl = await createCharacterFrame({
      firstFrameUrl,
      referenceImageUrl,
      swapMode: mode,
    });
    if (!hybridFrameUrl) throw new Error('Image model returned no result.');
    console.log('[character-frame] ok', { hybridFrameUrl });
    return res.status(200).json({ hybridFrameUrl });
  } catch (err) {
    console.error('[character-frame] failed; refunding credit', err);
    try {
      await refundCredits(entitlement, COST);
    } catch (e) {
      console.warn('[character-frame] refund failed', e?.message);
    }
    return res.status(500).json({ error: err.message || 'Image generation failed.' });
  }
}
