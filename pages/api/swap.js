import { v4 as uuidv4 } from 'uuid';

import { createJob, updateJob } from '../../lib/jobs';
import { createKlingPrediction, normalizeStatus } from '../../lib/replicate';
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = uuidv4();

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

  try {
    const {
      imageUrl,
      videoUrl,
      mode,
      videoFileName,
      faceFileName,
    } = req.body || {};

    if (!isHttpUrl(imageUrl) || !isHttpUrl(videoUrl)) {
      return res.status(400).json({
        error: 'imageUrl (character image) and videoUrl (motion video) are required.',
      });
    }

    const safeMode = mode === 'pro' ? 'pro' : 'std';

    createJob({
      jobId,
      status: 'queued',
      videoFileName: videoFileName || 'motion.mp4',
      faceFileName: faceFileName || 'character.jpg',
      mode: safeMode,
    });

    updateJob(jobId, { status: 'processing' });

    console.log('[swap] creating prediction', {
      jobId,
      imageUrl,
      videoUrl,
      mode: safeMode,
      characterOrientation: 'video',
    });

    const prediction = await createKlingPrediction({
      imageUrl,
      videoUrl,
      mode: safeMode,
      characterOrientation: 'video',
    });
    const normalized = normalizeStatus(prediction);

    console.log('[swap] prediction created', {
      jobId,
      predictionId: prediction.id,
      status: prediction.status,
    });

    updateJob(jobId, {
      predictionId: prediction.id,
      status: normalized.status === 'queued' ? 'processing' : normalized.status,
    });

    // Note: usage was already consumed at /api/banana-prep. The Kling
    // run is the paid payoff for that slot; no extra increment here.

    return res.status(200).json({
      jobId,
      predictionId: prediction.id,
      status: 'processing',
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'error',
      error: err.message || 'Unknown error',
    });
    return res.status(500).json({
      jobId,
      error: err.message || 'Generation failed to start.',
    });
  }
}
