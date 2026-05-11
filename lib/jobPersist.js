/*
 * Persist in-flight Replicate predictions to localStorage so the user
 * can leave the tab, switch apps, or close the phone and come back to
 * a job that's still being polled (or already finished).
 *
 * Replicate keeps running on their servers regardless of whether the
 * client is connected — this just remembers the predictionId so the
 * client can re-attach when the user returns.
 *
 * Each "feature" gets its own slot (face-swap, image-to-video, ugc).
 * Stored shape: { predictionId, kind, downloadName, savedAt, ...extras }
 */

const PREFIX = 'ariyalab:job:';
const MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h — Replicate predictions expire well before this.

function key(feature) {
  return `${PREFIX}${feature}`;
}

export function saveJob(feature, payload) {
  if (typeof window === 'undefined' || !payload) return;
  try {
    const entry = { ...payload, savedAt: Date.now() };
    window.localStorage.setItem(key(feature), JSON.stringify(entry));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — silent failure is fine.
  }
}

export function loadJob(feature) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(feature));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.predictionId) return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key(feature));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearJob(feature) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(feature));
  } catch {}
}
