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
