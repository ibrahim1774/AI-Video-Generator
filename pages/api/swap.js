import { v4 as uuidv4 } from 'uuid';

import { createJob, updateJob } from '../../lib/jobs';
import { createFaceSwapPrediction, normalizeStatus } from '../../lib/replicate';
import { getEntitlement, incrementUsage } from '../../lib/entitlement';

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

  // Gate on entitlement before doing anything else.
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
    const { videoUrl, faceUrl, videoFileName, faceFileName } = req.body || {};

    if (!isHttpUrl(videoUrl) || !isHttpUrl(faceUrl)) {
      return res.status(400).json({
        error: 'videoUrl and faceUrl are required (must be http/https URLs).',
      });
    }

    createJob({
      jobId,
      status: 'queued',
      videoFileName: videoFileName || 'video.mp4',
      faceFileName: faceFileName || 'face.jpg',
    });

    updateJob(jobId, { status: 'processing' });

    const prediction = await createFaceSwapPrediction({
      videoUrl,
      imageUrl: faceUrl,
    });
    const normalized = normalizeStatus(prediction);

    updateJob(jobId, {
      predictionId: prediction.id,
      status: normalized.status === 'queued' ? 'processing' : normalized.status,
    });

    // Best-effort usage increment (don't fail the swap if this errors).
    try {
      await incrementUsage(req, res, entitlement);
    } catch {
      // ignore
    }

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
      error: err.message || 'Face swap failed to start.',
    });
  }
}
