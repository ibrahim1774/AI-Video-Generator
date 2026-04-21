import { getPrediction, normalizeStatus } from '../../lib/replicate';
import { getKiePrediction, normalizeKieStatus } from '../../lib/kie';

/*
 * Polling endpoint. Dispatches to either Replicate (default — used for
 * nano-banana image predictions and the face-swap motion-transfer path)
 * or kie.ai (Kling 3.0 video generation). The client tells us which
 * vendor via the `vendor` query param, and that choice is persisted
 * alongside the predictionId in localStorage so resume-after-close
 * routes to the right backend.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { predictionId, vendor } = req.query;
  if (!predictionId || typeof predictionId !== 'string') {
    return res.status(400).json({ error: 'predictionId is required.' });
  }

  const isKie = vendor === 'kie';

  try {
    if (isKie) {
      const record = await getKiePrediction(predictionId);
      const normalized = normalizeKieStatus(record);
      return res.status(200).json({
        predictionId,
        status: normalized.status,
        resultUrl: normalized.resultUrl || null,
        error: normalized.status === 'error' ? normalized.error || 'Prediction failed' : null,
      });
    }
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
      error: err.message || 'Failed to reach provider.',
    });
  }
}
