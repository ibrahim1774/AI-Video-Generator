/*
 * Magic Hour API client.
 *
 * Thin fetch wrapper around the endpoints we need for face swap:
 *   - POST /files/upload-urls       (get presigned upload URLs)
 *   - PUT  <presignedUrl>           (upload the file)
 *   - POST /face-swap-video         (create a face-swap job)
 *   - GET  /video/projects/{id}     (poll job status)
 *
 * Docs: https://docs.magichour.ai
 *
 * Note: Magic Hour occasionally tweaks field names across versions; the
 * helpers below read responses defensively (camelCase and snake_case)
 * so a minor rename on their end won't break the app.
 */

const BASE_URL = 'https://api.magichour.ai/api/v1';

function apiKey() {
  const key = process.env.MAGIC_HOUR_API_KEY;
  if (!key) {
    throw new Error(
      'MAGIC_HOUR_API_KEY is not set. Copy .env.example to .env.local and add your key.'
    );
  }
  return key;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.error || data.detail)) ||
      `Magic Hour API error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/**
 * Request a presigned upload URL for a single file.
 * Returns { uploadUrl, filePath } suitable for uploadToPresignedUrl + createFaceSwapJob.
 */
export async function getUploadUrl(fileName, fileType) {
  const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
  const data = await request('/files/upload-urls', {
    method: 'POST',
    body: {
      items: [
        {
          name: fileName,
          extension,
          type: fileType,
        },
      ],
    },
  });

  const item = (data && data.items && data.items[0]) || data || {};
  const uploadUrl = item.upload_url || item.uploadUrl || data.upload_url || data.uploadUrl;
  const filePath = item.file_path || item.filePath || data.file_path || data.filePath;

  if (!uploadUrl || !filePath) {
    throw new Error('Magic Hour did not return a presigned upload URL.');
  }

  return { uploadUrl, filePath };
}

/**
 * PUT a file buffer to a Magic Hour presigned URL.
 */
export async function uploadToPresignedUrl(presignedUrl, fileBuffer, contentType) {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: fileBuffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Presigned upload failed (${res.status}): ${text || 'no body'}`);
  }
  return true;
}

/**
 * Kick off a face-swap render. Returns the created project payload.
 */
export async function createFaceSwapJob(
  videoFilePath,
  imageFilePath,
  startSeconds = 0,
  endSeconds = 10
) {
  const data = await request('/face-swap-video', {
    method: 'POST',
    body: {
      name: `FaceForge swap ${new Date().toISOString()}`,
      start_seconds: startSeconds,
      end_seconds: endSeconds,
      assets: {
        video_source: 'file',
        video_file_path: videoFilePath,
        image_file_path: imageFilePath,
      },
    },
  });

  const projectId = data.id || data.project_id || data.projectId;
  if (!projectId) {
    throw new Error('Magic Hour did not return a project ID.');
  }
  return { ...data, projectId };
}

/**
 * Read the current status of a video-generation project.
 */
export async function getVideoStatus(projectId) {
  return request(`/video/projects/${projectId}`);
}

/**
 * Poll getVideoStatus until terminal. Intended for server-side use; the
 * UI uses /api/status + its own polling loop.
 */
export async function waitForCompletion(
  projectId,
  type = 'face-swap',
  maxAttempts = 120,
  intervalMs = 3000
) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const data = await getVideoStatus(projectId);
    const normalized = normalizeStatus(data);
    if (normalized.status === 'complete') return { ...data, ...normalized };
    if (normalized.status === 'error') {
      const err = new Error(normalized.error || 'Magic Hour job failed');
      err.body = data;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const err = new Error(`Magic Hour ${type} job timed out after ${maxAttempts} polls`);
  err.code = 'TIMEOUT';
  throw err;
}

/**
 * Map Magic Hour status payload onto our internal shape:
 *   { status: 'queued'|'processing'|'complete'|'error', resultUrl, error }
 */
export function normalizeStatus(data) {
  if (!data) return { status: 'queued' };

  const raw = (data.status || data.state || '').toString().toLowerCase();
  let status = 'processing';
  if (['queued', 'pending', 'waiting'].includes(raw)) status = 'queued';
  else if (['complete', 'completed', 'succeeded', 'success'].includes(raw)) status = 'complete';
  else if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(raw)) status = 'error';

  const downloads = data.downloads || data.download_urls || [];
  const first = Array.isArray(downloads) ? downloads[0] : null;
  const resultUrl =
    (first && (first.url || first.download_url)) ||
    data.download_url ||
    data.result_url ||
    null;

  const error =
    data.error_message || data.error || (data.errors && data.errors[0]) || null;

  return { status, resultUrl, error };
}
