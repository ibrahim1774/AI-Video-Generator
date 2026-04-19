/*
 * Replicate API client for Kling 3.0 Motion Control.
 *
 * Model: kwaivgi/kling-v3-motion-control (official Replicate model)
 *   Inputs:
 *     - image                 (URL: character whose appearance to keep)
 *     - video                 (URL: motion to transfer onto the character)
 *     - mode                  ('std' | 'pro')  — 720p vs 1080p
 *     - character_orientation ('image' | 'video', default 'video')
 *     - prompt                (optional text guidance)
 *   Output: a single video URL on prediction.output.
 *
 * Official models can be referenced by `model` slug instead of a
 * pinned version hash, so we avoid the bookkeeping of version pins.
 *
 * Docs: https://replicate.com/kwaivgi/kling-v3-motion-control
 */

import Replicate from 'replicate';

export const MODEL = 'kwaivgi/kling-v3-motion-control';
export const BANANA_MODEL = 'google/nano-banana-pro';

const BANANA_PROMPT =
  "Replace the person's face and identity in the first image with the person from the second image. " +
  'Preserve the first image\u2019s exact pose, clothing, body proportions, background, lighting, framing, and camera angle. ' +
  'Keep the second image\u2019s facial features, skin tone, and hair. ' +
  'The result must look photorealistic and match the first image\u2019s style seamlessly.';

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
 * Kick off a Kling motion-control prediction.
 *
 * @param {object} args
 * @param {string} args.imageUrl - public URL of the character image
 * @param {string} args.videoUrl - public URL of the motion reference video
 * @param {'std'|'pro'} [args.mode='std'] - output quality
 * @param {'image'|'video'} [args.characterOrientation='video']
 * @param {string} [args.prompt] - optional text guidance
 */
export async function createKlingPrediction({
  imageUrl,
  videoUrl,
  mode = 'std',
  characterOrientation = 'video',
  prompt = '',
}) {
  const input = {
    image: imageUrl,
    video: videoUrl,
    mode,
    character_orientation: characterOrientation,
  };
  if (prompt && prompt.trim()) input.prompt = prompt.trim();

  return client().predictions.create({
    model: MODEL,
    input,
  });
}

/**
 * Stage 1 of the pipeline: ask Nano Banana Pro to compose the
 * reference character into the source video's first frame. Returns
 * the resulting hybrid frame URL synchronously (Banana is fast enough
 * to wait inline — typical run is 8\u201315 s).
 *
 * @param {object} args
 * @param {string} args.firstFrameUrl - public URL of the source video's frame 0
 * @param {string} args.referenceImageUrl - public URL of the user's character image
 */
export async function createBananaPrep({ firstFrameUrl, referenceImageUrl }) {
  const output = await client().run(BANANA_MODEL, {
    input: {
      prompt: BANANA_PROMPT,
      image_input: [firstFrameUrl, referenceImageUrl],
      output_format: 'jpg',
    },
  });
  // Nano Banana returns either a string URL or an array; normalize.
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length) {
    const first = output[0];
    return typeof first === 'string' ? first : first?.url?.() || first?.url || null;
  }
  if (output && typeof output === 'object') {
    return output.url?.() || output.url || null;
  }
  return null;
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

  // Surface as much error context as we can — Replicate puts it in
  // `error` (string or object) plus sometimes `logs`. We pass it
  // through verbatim so the UI can show the full message.
  let error = null;
  if (prediction.error) {
    error =
      typeof prediction.error === 'string'
        ? prediction.error
        : JSON.stringify(prediction.error);
  }

  return { status, resultUrl, error };
}
