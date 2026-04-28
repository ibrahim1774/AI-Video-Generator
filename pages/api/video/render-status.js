import { getUserFromRequest, getSupabaseAdmin } from '../../../lib/supabaseServer';
import { getJob } from '../../../lib/renderJobs';

/*
 * GET ?renderId=… → { status, progress, outputUrl, errorMessage }
 *
 * Cross-checks ownership: the requesting user must own the render
 * (mirrors how /api/checkout/claim guards on email match). Falls
 * back to the Supabase row if the in-memory job has been evicted —
 * happens after a redeploy or after the 1h TTL.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { renderId } = req.query;
  if (!renderId || typeof renderId !== 'string') {
    return res.status(400).json({ error: 'renderId required' });
  }

  const job = getJob(renderId);
  if (job) {
    if (job.userId !== session.user.id) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return res.status(200).json({
      status: job.status,
      progress: job.progress,
      outputUrl: job.outputUrl || null,
      errorMessage: job.errorMessage || null,
    });
  }

  // Fall back to the Supabase row.
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('video_renders')
      .select('user_id, status, output_url, error_message')
      .eq('render_id', renderId)
      .maybeSingle();
    if (error || !data) {
      return res.status(404).json({ error: 'Render not found.' });
    }
    if (data.user_id !== session.user.id) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return res.status(200).json({
      status: data.status,
      progress: data.status === 'completed' ? 1 : data.status === 'rendering' ? 0.5 : 0,
      outputUrl: data.output_url || null,
      errorMessage: data.error_message || null,
    });
  } catch (err) {
    console.error('[video/render-status] supabase lookup failed', err);
    return res.status(500).json({ error: 'Could not fetch render status.' });
  }
}
