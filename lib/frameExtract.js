/*
 * Browser-only helper to grab the first frame of a video File as a JPG.
 *
 * No ffmpeg-on-Vercel needed — the browser already has the video bytes.
 * Returns a File suitable for uploading via uploadTempFile() the same
 * way the source video and reference image flow.
 */

export async function extractFirstFrame(videoFile) {
  if (typeof window === 'undefined') {
    throw new Error('extractFirstFrame must run in the browser.');
  }

  const objectUrl = URL.createObjectURL(videoFile);
  try {
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
      const onError = () => reject(new Error('Could not load video for frame extraction.'));
      video.onerror = onError;
      video.onloadeddata = () => {
        // Seek a hair past 0 to ensure decoded data is available on all browsers.
        try {
          video.currentTime = 0.05;
        } catch {
          resolve();
        }
      };
      video.onseeked = () => resolve();
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
        'image/jpeg',
        0.92
      );
    });

    const baseName = (videoFile.name || 'source').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}-frame0.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
