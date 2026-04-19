import { getPrediction, normalizeStatus } from '../../lib/replicate';

/*
 * Polling endpoint. The browser hits this with the Replicate
 * predictionId returned from /api/swap. We talk straight to
 * Replicate — no in-memory job store lookup, because Vercel
 * serverless instances don't share memory.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { predictionId } = req.query;
  if (!predictionId || typeof predictionId !== 'string') {
    return res.status(400).json({ error: 'predictionId is required.' });
  }

  try {
    const prediction = await getPrediction(predictionId);
    const normalized = normalizeStatus(prediction);
    return res.status(200).json({
      predictionId,
      status: normalized.status,
      resultUrl: normalized.resultUrl || null,
      error: normalized.status === 'error' ? normalized.error || 'Prediction failed' : null,
    });
  } catch (err) {
    return res.status(502).json({
      predictionId,
      status: 'processing',
      error: err.message || 'Failed to reach Replicate.',
    });
  }
}
