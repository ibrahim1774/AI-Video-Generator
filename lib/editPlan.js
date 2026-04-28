/*
 * Edit-plan schema + validator. Single source of truth for the AI
 * planner (pages/api/video/plan-edits.js) and the FFmpeg compiler
 * (lib/ffmpegRender.js).
 *
 * The validator is the security boundary against the AI inventing
 * dangerous operations — anything not in OPERATION_TYPES is rejected.
 */

export const OPERATION_TYPES = [
  'trim',
  'speed',
  'textOverlay',
  'captions',
  'audioTrack',
  'fade',
  'crop',
  'filter',
  'reverse',
];

export const MAX_OUTPUT_SECONDS = 60; // Vercel serverless cap
export const MAX_OPERATIONS = 20;

const POSITIONS = ['top', 'center', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5'];

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function validateOperation(op, idx) {
  const errors = [];
  if (!op || typeof op !== 'object') {
    return [`operations[${idx}] is not an object`];
  }
  if (typeof op.id !== 'string' || !op.id) {
    errors.push(`operations[${idx}].id is required`);
  }
  if (!OPERATION_TYPES.includes(op.type)) {
    errors.push(`operations[${idx}].type "${op.type}" is not allowed`);
    return errors; // bail early — type is the dispatch key
  }

  switch (op.type) {
    case 'trim':
      if (!isFiniteNumber(op.start) || op.start < 0) errors.push(`operations[${idx}].start must be >= 0`);
      if (!isFiniteNumber(op.end) || op.end <= op.start) errors.push(`operations[${idx}].end must be > start`);
      break;
    case 'speed':
      if (!isFiniteNumber(op.factor) || op.factor < 0.25 || op.factor > 4) {
        errors.push(`operations[${idx}].factor must be between 0.25 and 4`);
      }
      break;
    case 'textOverlay':
      if (typeof op.text !== 'string' || !op.text.trim()) errors.push(`operations[${idx}].text required`);
      if (!isFiniteNumber(op.start) || op.start < 0) errors.push(`operations[${idx}].start required`);
      if (!isFiniteNumber(op.end) || op.end <= op.start) errors.push(`operations[${idx}].end must be > start`);
      if (op.position && !POSITIONS.includes(op.position)) {
        errors.push(`operations[${idx}].position must be one of ${POSITIONS.join(', ')}`);
      }
      if (op.fontSize !== undefined && (!isFiniteNumber(op.fontSize) || op.fontSize < 8 || op.fontSize > 256)) {
        errors.push(`operations[${idx}].fontSize must be 8-256`);
      }
      break;
    case 'captions':
      if (!Array.isArray(op.segments) || !op.segments.length) {
        errors.push(`operations[${idx}].segments must be a non-empty array`);
        break;
      }
      op.segments.forEach((s, si) => {
        if (!isFiniteNumber(s.start) || s.start < 0) errors.push(`operations[${idx}].segments[${si}].start invalid`);
        if (!isFiniteNumber(s.end) || s.end <= s.start) errors.push(`operations[${idx}].segments[${si}].end invalid`);
        if (typeof s.text !== 'string' || !s.text.trim()) errors.push(`operations[${idx}].segments[${si}].text required`);
      });
      break;
    case 'audioTrack':
      if (!isHttpUrl(op.url)) errors.push(`operations[${idx}].url must be a valid http(s) URL`);
      if (op.volume !== undefined && (!isFiniteNumber(op.volume) || op.volume < 0 || op.volume > 2)) {
        errors.push(`operations[${idx}].volume must be 0-2`);
      }
      break;
    case 'fade':
      if (op.direction !== 'in' && op.direction !== 'out') {
        errors.push(`operations[${idx}].direction must be "in" or "out"`);
      }
      if (!isFiniteNumber(op.duration) || op.duration <= 0 || op.duration > 10) {
        errors.push(`operations[${idx}].duration must be 0-10s`);
      }
      break;
    case 'crop':
      if (!ASPECT_RATIOS.includes(op.aspectRatio)) {
        errors.push(`operations[${idx}].aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`);
      }
      break;
    case 'filter':
      ['brightness', 'contrast', 'saturation'].forEach((k) => {
        if (op[k] !== undefined && (!isFiniteNumber(op[k]) || op[k] < -1 || op[k] > 3)) {
          errors.push(`operations[${idx}].${k} must be -1 to 3`);
        }
      });
      break;
    case 'reverse':
      // No params.
      break;
    default:
      errors.push(`operations[${idx}].type "${op.type}" not implemented`);
  }
  return errors;
}

export function validateEditPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['plan must be an object'] };
  }
  if (!isHttpUrl(plan.sourceUrl)) errors.push('sourceUrl must be a valid http(s) URL');
  if (!isFiniteNumber(plan.duration) || plan.duration <= 0) errors.push('duration must be > 0');
  if (!isFiniteNumber(plan.width) || plan.width < 16) errors.push('width must be >= 16');
  if (!isFiniteNumber(plan.height) || plan.height < 16) errors.push('height must be >= 16');
  if (!Array.isArray(plan.operations)) {
    errors.push('operations must be an array');
    return { valid: false, errors };
  }
  if (plan.operations.length > MAX_OPERATIONS) {
    errors.push(`operations may not exceed ${MAX_OPERATIONS}`);
  }
  plan.operations.forEach((op, i) => {
    errors.push(...validateOperation(op, i));
  });

  // Output-duration cap. Approximate: trim + speed are the only ops
  // that change duration. Calculate effective duration to enforce the
  // Vercel timeout guard.
  const effective = effectiveDuration(plan);
  if (effective > MAX_OUTPUT_SECONDS) {
    errors.push(`output duration ${effective.toFixed(1)}s exceeds the ${MAX_OUTPUT_SECONDS}s cap`);
  }

  if (errors.length) return { valid: false, errors };
  return { valid: true };
}

/**
 * Estimate the output duration in seconds given the operation chain.
 * Used both for validation and for credit cost / UI display.
 */
export function effectiveDuration(plan) {
  let dur = plan.duration || 0;
  for (const op of plan.operations || []) {
    if (op.type === 'trim') dur = Math.max(0, op.end - op.start);
    if (op.type === 'speed' && op.factor > 0) dur = dur / op.factor;
  }
  return dur;
}

export function emptyPlan({ sourceUrl, duration, width, height }) {
  return {
    sourceUrl,
    duration,
    width: width || 1080,
    height: height || 1920,
    operations: [],
  };
}

/**
 * Schema description fed to the AI planner so it knows exactly what
 * shape to return. Keep this in sync with validateOperation above.
 */
export const SCHEMA_DESCRIPTION = `
Each operation must be one of these types with the listed fields:

- { id: string, type: "trim", start: number (seconds), end: number (seconds) }
- { id: string, type: "speed", factor: number (0.25 to 4) }
- { id: string, type: "textOverlay", text: string, start: number, end: number,
    position?: "top"|"center"|"bottom"|"top-left"|"top-right"|"bottom-left"|"bottom-right",
    fontSize?: number (8-256), color?: string (hex like "#fff") }
- { id: string, type: "captions", segments: [{ start: number, end: number, text: string }] }
- { id: string, type: "audioTrack", url: string (https), volume?: number (0-2), start?: number }
- { id: string, type: "fade", direction: "in"|"out", duration: number (0-10) }
- { id: string, type: "crop", aspectRatio: "9:16"|"16:9"|"1:1"|"4:5" }
- { id: string, type: "filter", brightness?: number (-1 to 3), contrast?: number, saturation?: number }
- { id: string, type: "reverse" }

Generate unique ids like "op_<short-random>". Operations apply in order.
Never invent operation types not in this list.
`;
