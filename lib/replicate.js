/*
 * Replicate API client for video face-swap.
 *
 * Model: arabyai-replicate/roop_face_swap
 *   Inputs:
 *     - swap_image    (image: source face)
 *     - target_video  (video: clip to face-swap into)
 *   Output: a single string URL pointing at the rendered MP4 on
 *           replicate.delivery.
 *
 * The official `replicate` SDK auto-uploads any Buffer / Blob / File
 * passed as input (≤100 MiB), so we hand it raw buffers and let it
 * handle the storage round-trip.
 *
 * Docs: https://replicate.com/docs and https://github.com/replicate/replicate-javascript
 */

import Replicate from 'replicate';

export const MODEL = 'arabyai-replicate/roop_face_swap';
// Pinned version hash — bump deliberately when upstream publishes a new build.
export const MODEL_VERSION =
  '11b6bf0f4e14d808f655e87e5448233cceff10a45f659d71539cafb7163b2e84';

let cached = null;
function client() {
  if (cached) return cached;
  const auth = process.env.REPLICATE_API_TOKEN;
  if (!auth) {
    throw new Error(
      'REPLICATE_API_TOKEN is not set. Copy .env.example to .env.local and add your token.'
    );
  }
  cached = new Replicate({ auth });
  return cached;
}

/**
 * Kick off a face-swap prediction. `videoUrl` + `imageUrl` are public
 * URLs (e.g. tmpfiles.org direct-download links) that Replicate will
 * fetch server-side.
 *
 * Returns the raw prediction object; caller stores `prediction.id`.
 */
export async function createFaceSwapPrediction({ videoUrl, imageUrl }) {
  return client().predictions.create({
    version: MODEL_VERSION,
    input: {
      target_video: videoUrl,
      swap_image: imageUrl,
    },
  });
}

/** Fetch the current state of a prediction by id. */
export async function getPrediction(id) {
  return client().predictions.get(id);
}

/**
 * Map a Replicate prediction onto FaceForge's internal shape:
 *   { status: 'queued'|'processing'|'complete'|'error', resultUrl, error }
 *
 * Replicate statuses: starting | processing | succeeded | failed | canceled
 */
export function normalizeStatus(prediction) {
  if (!prediction) return { status: 'queued' };

  const raw = (prediction.status || '').toLowerCase();
  let status = 'processing';
  if (raw === 'starting') status = 'queued';
  else if (raw === 'succeeded') status = 'complete';
  else if (raw === 'failed' || raw === 'canceled') status = 'error';

  let resultUrl = null;
  const out = prediction.output;
  if (typeof out === 'string') resultUrl = out;
  else if (Array.isArray(out) && out.length) resultUrl = out[0];
  else if (out && typeof out === 'object') resultUrl = out.url || out.video || null;

  const error = prediction.error || null;

  return { status, resultUrl, error };
}
