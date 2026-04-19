/*
 * Browser-only file uploader using Vercel Blob.
 *
 * Vercel serverless functions cap request bodies at 4.5 MB, so we
 * can't push videos through our own API. Instead the browser uses
 * @vercel/blob/client's `upload()` to:
 *   1. Hit /api/upload-token for a short-lived token.
 *   2. PUT the file directly to *.blob.vercel-storage.com.
 *   3. Return the public URL we then hand to Replicate.
 *
 * Requires BLOB_READ_WRITE_TOKEN in project env vars (auto-added by
 * Vercel when you create a Blob store under the Storage tab).
 */

import { upload } from '@vercel/blob/client';
import { log } from './debugLog';

export async function uploadTempFile(file) {
  log('info', 'upload start', { name: file.name, size: file.size, type: file.type });
  try {
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/upload-token',
    });
    log('info', 'upload ok', { name: file.name, url: blob.url });
    return blob.url;
  } catch (err) {
    log('error', 'upload failed', {
      name: file.name,
      message: err && err.message,
      stack: err && err.stack && err.stack.split('\n').slice(0, 4).join('\n'),
    });
    throw err;
  }
}
