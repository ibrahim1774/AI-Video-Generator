/*
 * Browser-only temporary file uploader.
 *
 * Vercel serverless functions cap request bodies at 4.5 MB, so we
 * can't upload videos through our own API. Instead the browser
 * uploads each file directly to tmpfiles.org (free, no signup,
 * 100 MB max, files auto-delete after 60 min) and we hand the
 * resulting URL to Replicate, which fetches it server-side.
 *
 * NOT for production. Replace with Vercel Blob / R2 / S3 before
 * launch. The single `uploadTempFile` export is the swap point.
 */

const ENDPOINT = 'https://tmpfiles.org/api/v1/upload';

/**
 * Upload a File/Blob to tmpfiles.org, return a direct-download URL
 * suitable for passing to Replicate as a model input.
 */
export async function uploadTempFile(file) {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
  if (!res.ok) {
    throw new Error(`Temp upload failed (${res.status} ${res.statusText})`);
  }

  const json = await res.json().catch(() => null);
  const viewerUrl = json && json.data && json.data.url;
  if (!viewerUrl) {
    throw new Error('Temp host returned no URL.');
  }

  // tmpfiles returns a viewer URL like https://tmpfiles.org/12345/clip.mp4
  // Replicate needs the raw file, served at https://tmpfiles.org/dl/12345/clip.mp4
  return viewerUrl.replace('://tmpfiles.org/', '://tmpfiles.org/dl/');
}
