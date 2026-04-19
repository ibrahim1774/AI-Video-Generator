/*
 * Browser-only temporary file uploader.
 *
 * Vercel serverless functions cap request bodies at 4.5 MB, so we
 * can't upload videos through our own API. Instead the browser
 * uploads each file directly to litterbox.catbox.moe (the temporary
 * variant of catbox.moe — free, no signup, 1 GB max, files
 * auto-delete after the requested window) and we hand the resulting
 * URL to Replicate, which fetches it server-side.
 *
 * NOT for production. Replace with Vercel Blob / R2 / S3 before
 * launch. The single `uploadTempFile` export is the swap point.
 */

const ENDPOINT = 'https://litterbox.catbox.moe/resources/internals/api.php';
const RETENTION = '1h'; // valid: 1h, 12h, 24h, 72h

/**
 * Upload a File/Blob to litterbox, return a direct file URL
 * suitable for passing to Replicate as a model input.
 */
export async function uploadTempFile(file) {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('time', RETENTION);
  fd.append('fileToUpload', file);

  let res;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', body: fd });
  } catch (err) {
    throw new Error(
      `Could not reach the temp file host (${err.message || 'network error'}). ` +
        'Check your connection or disable ad-blockers for this page.'
    );
  }

  if (!res.ok) {
    throw new Error(`Temp upload failed (${res.status} ${res.statusText})`);
  }

  const url = (await res.text()).trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Temp host returned an unexpected response: ${url.slice(0, 120)}`);
  }
  return url;
}
