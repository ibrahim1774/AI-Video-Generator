/*
 * Browser-only helper to grab the first frame of a video File as a JPG.
 *
 * Two strategies, tried in order:
 *   1. Play-based (most reliable): briefly play() the video, capture the
 *      first decoded frame via requestVideoFrameCallback / 'playing' event.
 *   2. Seek-based fallback: setCurrentTime + 'seeked'.
 *
 * Detailed errors include MediaError codes so the debug console shows
 * exactly what failed (codec unsupported, network, decode error, etc.).
 */

const MEDIA_ERROR_NAMES = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED (codec/container not supported by this browser)',
};

function describeError(video) {
  const e = video?.error;
  if (!e) return 'unknown';
  const name = MEDIA_ERROR_NAMES[e.code] || `code ${e.code}`;
  return `${name}${e.message ? ` — ${e.message}` : ''}`;
}

function captureCanvas(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToFile(canvas, baseName) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(new File([b], `${baseName}-frame0.jpg`, { type: 'image/jpeg' }))
          : reject(new Error('Canvas toBlob returned null')),
      'image/jpeg',
      0.92
    );
  });
}

function tryPlayBased(video) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      video.onplaying = null;
      video.onerror = null;
    };
    const grab = () => {
      if (resolved) return;
      resolved = true;
      try {
        const canvas = captureCanvas(video);
        video.pause();
        cleanup();
        resolve(canvas);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    video.onplaying = grab;
    video.onerror = () => {
      cleanup();
      reject(new Error(`Video error: ${describeError(video)}`));
    };
    if ('requestVideoFrameCallback' in video) {
      try {
        video.requestVideoFrameCallback(grab);
      } catch {
        // ignore — onplaying will fire
      }
    }
    video.play().catch((err) => {
      if (!resolved) {
        cleanup();
        reject(new Error(`play() rejected: ${err.message}`));
      }
    });
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error('Timed out waiting for first frame (play strategy).'));
      }
    }, 8000);
  });
}

function trySeekBased(video) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const cleanup = () => {
      video.onseeked = null;
      video.onerror = null;
    };
    video.onseeked = () => {
      if (resolved) return;
      resolved = true;
      try {
        const canvas = captureCanvas(video);
        cleanup();
        resolve(canvas);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(`Video error: ${describeError(video)}`));
    };
    try {
      video.currentTime = 0.05;
    } catch (err) {
      cleanup();
      reject(new Error(`Could not seek: ${err.message}`));
      return;
    }
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error('Timed out waiting for seek.'));
      }
    }, 8000);
  });
}

export async function extractFirstFrame(videoFile) {
  if (typeof window === 'undefined') {
    throw new Error('extractFirstFrame must run in the browser.');
  }

  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.src = objectUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  try {
    // Wait for metadata so videoWidth/Height are populated.
    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('Timed out loading video metadata (10s).')),
        10000
      );
      video.onloadedmetadata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(
          new Error(
            `Browser cannot decode this video (${describeError(video)}). ` +
              'iPhone .mov files often use HEVC which most browsers reject. ' +
              'Try re-encoding as H.264 MP4.'
          )
        );
      };
    });

    let canvas;
    try {
      canvas = await tryPlayBased(video);
    } catch (playErr) {
      try {
        canvas = await trySeekBased(video);
      } catch (seekErr) {
        const err = new Error(
          `Could not capture frame in browser. Play: ${playErr.message}. Seek: ${seekErr.message}.`
        );
        err.code = 'BROWSER_DECODE_FAILED';
        throw err;
      }
    }

    const baseName = (videoFile.name || 'source').replace(/\.[^.]+$/, '');
    return await canvasToFile(canvas, baseName);
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute('src');
    video.load?.();
  }
}
