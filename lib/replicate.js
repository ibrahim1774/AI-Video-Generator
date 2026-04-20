/*
 * Replicate API client. Internal model identifiers live here only —
 * never expose them in user-facing copy.
 */

import Replicate from 'replicate';

// Internal Replicate model slugs (do not surface in UI):
export const MOTION_TRANSFER_MODEL = 'kwaivgi/kling-v3-motion-control';
export const IMAGE_MODEL = 'google/nano-banana-pro';
export const IMAGE_TO_VIDEO_MODEL = 'kwaivgi/kling-v2.1';
export const ALLOWED_DURATIONS = [5, 10];

const CHARACTER_FRAME_PROMPT_FACE =
  'The first image is a frame from a video showing a person in a specific scene. ' +
  'The second image is a reference photograph of a different person whose face I want to use. ' +
  'Generate a new image that is PIXEL-IDENTICAL to the first image in every way — same background, same scenery, ' +
  'same lighting, same camera angle and framing, same body pose, same hands, same clothing, same hair color and style, ' +
  'same overall color grading — EXCEPT that the face has been replaced with the face of the person in the second image. ' +
  "Take the second image's exact facial features, skin tone, eye color, nose shape, mouth, and overall identity, " +
  "and blend that face seamlessly onto the first image's body and head. " +
  'The seam between the new face and the existing neck and hair must be invisible. ' +
  'Do not change anything outside of the facial region. ' +
  "The result must look like a real photograph from the original scene, just with a different person's face.";

const CHARACTER_FRAME_PROMPT_BODY =
  'The first image is a frame from a video showing a person in a specific scene and pose. ' +
  'The second image is a reference photograph of a different person whose entire appearance I want to use. ' +
  "Generate a new image that keeps the first image's exact background, scenery, camera angle, framing, and lighting, " +
  'and keeps the POSE and BODY POSITION of the person in the first image. ' +
  'But replace the entire character — face, body, hands, hair, clothing, accessories, and skin tone — with the appearance ' +
  'of the person in the second image. ' +
  "So the output should look like the second image's person performing the first image's pose, in the first image's environment. " +
  'Match the lighting and color grading of the first image so the new character looks naturally lit by that scene. ' +
  'Do not change the background, props, or environment.';

export const SWAP_MODES = ['face', 'body'];

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
 * Kick off a motion-transfer prediction (source video motion onto a
 * character image).
 *
 * @param {object} args
 * @param {string} args.imageUrl - public URL of the character image
 * @param {string} args.videoUrl - public URL of the motion reference video
 * @param {'std'|'pro'} [args.mode='std'] - 720p vs 1080p
 * @param {'image'|'video'} [args.characterOrientation='video']
 * @param {string} [args.prompt] - optional text guidance
 */
export async function createMotionTransferPrediction({
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
    model: MOTION_TRANSFER_MODEL,
    input,
  });
}

/**
 * Stage 1 of the face-swap pipeline: build a hybrid first frame that
 * places the user's reference character into the source video's frame
 * zero. Returns the resulting image URL synchronously (the call is
 * fast enough to await — typically 8–15 s).
 *
 * @param {object} args
 * @param {string} args.firstFrameUrl - public URL of the source video's frame 0
 * @param {string} args.referenceImageUrl - public URL of the user's character image
 */
export async function createCharacterFrame({ firstFrameUrl, referenceImageUrl, swapMode = 'face' }) {
  const prompt = swapMode === 'body' ? CHARACTER_FRAME_PROMPT_BODY : CHARACTER_FRAME_PROMPT_FACE;
  const output = await client().run(IMAGE_MODEL, {
    input: {
      prompt,
      image_input: [firstFrameUrl, referenceImageUrl],
      output_format: 'jpg',
    },
  });
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

/**
 * Image-to-video prediction (5s or 10s clip from a starting image).
 */
export async function createImageToVideoPrediction({
  imageUrl,
  prompt = '',
  duration = 5,
  mode = 'std',
}) {
  const dur = ALLOWED_DURATIONS.includes(duration) ? duration : 5;
  const input = {
    start_image: imageUrl,
    prompt: (prompt || '').trim() || 'natural motion',
    duration: dur,
  };
  // Only set the mode field when the user upgraded to pro. Defaulting
  // to the model's own native default avoids guessing the exact
  // string ("std" vs "standard") the schema accepts for the std tier.
  if (mode === 'pro') input.mode = 'pro';
  return client().predictions.create({
    model: IMAGE_TO_VIDEO_MODEL,
    input,
  });
}

/**
 * Generate a fresh character image from a text prompt (no source frame).
 * Returns the resulting image URL.
 */
export async function createImage({ prompt }) {
  const cleaned = (prompt || '').trim();
  if (!cleaned) throw new Error('Prompt is required.');
  const output = await client().run(IMAGE_MODEL, {
    input: {
      prompt: cleaned,
      output_format: 'jpg',
    },
  });
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
 * Map a Replicate prediction onto the app's internal shape:
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

  let error = null;
  if (prediction.error) {
    error =
      typeof prediction.error === 'string'
        ? prediction.error
        : JSON.stringify(prediction.error);
  }

  return { status, resultUrl, error };
}
