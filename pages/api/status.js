import { getJob, updateJob } from '../../lib/jobs';
import { getVideoStatus, normalizeStatus } from '../../lib/magichour';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId } = req.query;
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required.' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  if (job.status === 'complete' || job.status === 'error') {
    return res.status(200).json(job);
  }

  if (!job.projectId) {
    return res.status(200).json(job);
  }

  try {
    const raw = await getVideoStatus(job.projectId);
    const normalized = normalizeStatus(raw);

    const patch = { status: normalized.status };
    if (normalized.resultUrl) patch.resultUrl = normalized.resultUrl;
    if (normalized.status === 'error') patch.error = normalized.error || 'Magic Hour job failed';

    const updated = updateJob(jobId, patch);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(502).json({
      ...job,
      error: err.message || 'Failed to reach Magic Hour.',
    });
  }
}
