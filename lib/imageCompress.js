/*
 * Client-side image compression. Photos straight from a phone camera
 * (especially iPhone HEIC files re-encoded by Safari) can be 30-70 MB
 * even when the visible content would fit in 1-2 MB. We re-encode any
 * image above the threshold to a reasonable max dimension as JPEG.
 *
 * Returns a File. If the input is already small or compression fails,
 * returns the original file unchanged.
 */

const DEFAULT_THRESHOLD_MB = 5;
const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 0.9;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export async function maybeCompressImage(file, opts = {}) {
  if (!file || typeof window === 'undefined') return file;
  if (!file.type || !file.type.startsWith('image/')) return file;

  const thresholdBytes = (opts.thresholdMB || DEFAULT_THRESHOLD_MB) * 1024 * 1024;
  if (file.size <= thresholdBytes) return file;

  const maxDim = opts.maxDimension || DEFAULT_MAX_DIMENSION;
  const quality = opts.quality || DEFAULT_QUALITY;

  try {
    const dataUrl = await readAsDataURL(file);
    const img = await loadImage(dataUrl);
    const { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!blob) return file;

    // If the "compressed" version somehow ended up larger, keep the original.
    if (blob.size >= file.size) return file;

    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
