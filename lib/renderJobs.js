/*
 * In-memory job tracker for video edit renders.
 *
 * The render API spawns a long-running ffmpeg job and returns a
 * renderId immediately; the client polls /api/video/render-status to
 * read progress. Single-instance only — fine for v1, not for
 * horizontal scale. When that becomes a problem, swap this Map for a
 * Supabase-backed `video_renders` row update (the row is already
 * being created, just needs progress columns added).
 *
 * Shape:
 *   {
 *     status: 'rendering' | 'completed' | 'failed',
 *     progress: 0..1,
 *     userId: string,
 *     outputUrl?: string,
 *     errorMessage?: string,
 *     createdAt: number,
 *   }
 */

const jobs = new Map();
const TTL_MS = 1000 * 60 * 60; // 1 hour — plenty for a 60s render

export function createJob(renderId, userId) {
  jobs.set(renderId, {
    status: 'rendering',
    progress: 0,
    userId,
    createdAt: Date.now(),
  });
}

export function updateProgress(renderId, progress) {
  const job = jobs.get(renderId);
  if (!job) return;
  job.progress = Math.min(0.99, Math.max(0, progress));
}

export function completeJob(renderId, outputUrl) {
  const job = jobs.get(renderId);
  if (!job) return;
  job.status = 'completed';
  job.progress = 1;
  job.outputUrl = outputUrl;
}

export function failJob(renderId, errorMessage) {
  const job = jobs.get(renderId);
  if (!job) return;
  job.status = 'failed';
  job.errorMessage = errorMessage;
}

export function getJob(renderId) {
  // Opportunistic TTL sweep — keeps the Map from growing forever.
  if (Math.random() < 0.05) {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, j] of jobs.entries()) {
      if (j.createdAt < cutoff) jobs.delete(id);
    }
  }
  return jobs.get(renderId) || null;
}
