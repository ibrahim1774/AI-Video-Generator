/*
 * Persistence for multi-scene "story" state in the UGC creator.
 *
 * A story is the ordered list of completed scenes that the user has
 * chained together via the Extend / New scene buttons on the result
 * screen. Each scene is a standalone kie.ai generation that finished
 * successfully — we track them here so the result screen can present
 * a rail of thumbnails, offer Combine & download, and resume the
 * chain across tab close.
 *
 * The single in-flight generation is still tracked by jobPersist.js;
 * this module only stores completed scenes and the story scaffolding.
 */

const PREFIX = 'ariyalab:story:';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — stored video URLs expire well before this.

function key(feature) {
  return `${PREFIX}${feature}`;
}

function emptyStory(feature) {
  return {
    feature,
    startingImageUrl: null,
    scenes: [],
    combinedUrl: null,
    savedAt: Date.now(),
  };
}

export function loadStory(feature) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(feature));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.feature !== feature) return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key(feature));
      return null;
    }
    // Backfill missing fields defensively.
    return {
      feature,
      startingImageUrl: parsed.startingImageUrl || null,
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      combinedUrl: parsed.combinedUrl || null,
      savedAt: parsed.savedAt || Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveStory(feature, story) {
  if (typeof window === 'undefined' || !story) return;
  try {
    window.localStorage.setItem(
      key(feature),
      JSON.stringify({ ...story, feature, savedAt: Date.now() })
    );
  } catch {}
}

export function clearStory(feature) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key(feature));
  } catch {}
}

/**
 * Append a completed scene to the story. Creates the story if it
 * didn't exist yet (first scene is always the anchor).
 */
export function appendScene(feature, scene, startingImageUrl) {
  const existing = loadStory(feature) || emptyStory(feature);
  const next = {
    ...existing,
    startingImageUrl: existing.startingImageUrl || startingImageUrl || null,
    scenes: [...existing.scenes, scene],
    combinedUrl: null, // invalidated — user must re-combine
  };
  saveStory(feature, next);
  return next;
}

/** Drop the last scene (Undo). Returns the updated story or null if empty. */
export function popScene(feature) {
  const existing = loadStory(feature);
  if (!existing || existing.scenes.length === 0) return existing;
  const next = {
    ...existing,
    scenes: existing.scenes.slice(0, -1),
    combinedUrl: null,
  };
  if (next.scenes.length === 0) {
    clearStory(feature);
    return null;
  }
  saveStory(feature, next);
  return next;
}

/** Record the combined URL once concat completes. */
export function setCombinedUrl(feature, url) {
  const existing = loadStory(feature);
  if (!existing) return null;
  const next = { ...existing, combinedUrl: url };
  saveStory(feature, next);
  return next;
}
