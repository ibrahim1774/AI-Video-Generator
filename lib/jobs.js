/*
 * In-memory job store.
 *
 * This is a demo-grade store that only survives for the lifetime of the
 * Node process. To move to production, swap the Map below for a real
 * persistent store. The function signatures here are intentionally
 * narrow (createJob / getJob / updateJob / listJobs) so you can drop in
 * a Supabase or Postgres client without touching callers.
 *
 * Supabase example:
 *   const { data } = await supabase.from('jobs').insert({...}).select().single();
 * Postgres (node-postgres) example:
 *   await pool.query('INSERT INTO jobs (...) VALUES (...)', [...]);
 */

const jobs = new Map();

export function createJob(job) {
  const record = {
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectId: null,
    resultUrl: null,
    error: null,
    ...job,
  };
  jobs.set(record.jobId, record);
  return record;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function updateJob(jobId, patch) {
  const existing = jobs.get(jobId);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  jobs.set(jobId, next);
  return next;
}

export function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}
