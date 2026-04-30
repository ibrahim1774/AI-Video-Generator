import { v4 as uuidv4 } from 'uuid';

import { getUserFromRequest, getSupabaseAdmin } from '../../../lib/supabaseServer';
import { getEntitlement, reserveCredits, refundCredits } from '../../../lib/entitlement';
import { validateEditPlan } from '../../../lib/editPlan';
import { renderEditPlan } from '../../../lib/ffmpegRender';
import { createJob, updateProgress, completeJob, failJob } from '../../../lib/renderJobs';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};

/*
 * Kicks off an edit-plan render. Reserves 1 credit, returns a
 * renderId immediately, and spawns ffmpeg in the background. Client
 * polls /api/video/render-status to watch progress.
 *
 * On success: writes outputUrl to the video_renders Supabase row.
 * On failure: refunds the credit and marks the row as failed.
 *
 * Note on Vercel runtime: the maxDuration of 300s is the upper bound
 * on this serverless invocation. ffmpeg runs inside it. If a render
 * takes longer than 300s the function is killed by Vercel and the
 * job is marked failed by the next poll (since the in-memory map will
 * still say "rendering" but the function is gone). Output cap of 60s
 * in lib/editPlan.js makes that very unlikely in practice.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { editPlan } = req.body || {};
  if (!editPlan) return res.status(400).json({ error: 'editPlan required' });

  const planCheck = validateEditPlan(editPlan);
  if (!planCheck.valid) {
    return res.status(400).json({ error: 'editPlan invalid', details: planCheck.errors });
  }

  // Credit gate — reuses the same path as /api/swap.
  let entitlement;
  try {
    entitlement = await getEntitlement({
      supabase: session.supabase,
      userId: session.user.id,
      email: session.user.email,
    });
    await reserveCredits(entitlement, 1);
  } catch (err) {
    if (err.code === 'NO_PLAN' || err.code === 'INSUFFICIENT') {
      return res.status(402).json({
        error: err.code === 'NO_PLAN' ? 'No active plan.' : 'Insufficient credits.',
        code: err.code,
        remaining: err.remaining,
      });
    }
    console.error('[video/render] credit reservation failed', err);
    return res.status(500).json({ error: 'Could not reserve credit.' });
  }

  const renderId = uuidv4();
  createJob(renderId, session.user.id);

  // Persist a row so we can audit + show history later. The output
  // URL is filled in once the render completes.
  let supabaseRow = null;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('video_renders')
      .insert({
        user_id: session.user.id,
        render_id: renderId,
        edit_plan: editPlan,
        status: 'rendering',
      })
      .select()
      .single();
    if (error) {
      console.warn('[video/render] could not insert video_renders row', error.message);
    } else {
      supabaseRow = data;
    }
  } catch (err) {
    console.warn('[video/render] supabase insert threw', err.message);
  }

  // Respond immediately so the client can start polling.
  res.status(200).json({ renderId });

  // Run the render. We've already responded, so any error here is
  // surfaced via render-status (and the credit refund + DB update).
  try {
    const result = await renderEditPlan(editPlan, {
      onProgress: (p) => updateProgress(renderId, p),
    });
    completeJob(renderId, result.outputUrl);
    if (supabaseRow) {
      try {
        const admin = getSupabaseAdmin();
        await admin
          .from('video_renders')
          .update({
            status: 'completed',
            output_url: result.outputUrl,
            completed_at: new Date().toISOString(),
          })
          .eq('render_id', renderId);
      } catch (dbErr) {
        console.warn('[video/render] could not update completed row', dbErr.message);
      }
    }
    // Also surface in /history so the user can find it for 24h.
    try {
      const admin = getSupabaseAdmin();
      const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
      await admin.from('videos').upsert(
        {
          user_id: session.user.id,
          prediction_id: renderId,
          kind: 'video-edit',
          result_url: result.outputUrl,
          is_blob_owned: true,
          expires_at: expiresAt,
        },
        { onConflict: 'prediction_id', ignoreDuplicates: true }
      );
    } catch (histErr) {
      console.warn('[video/render] history insert failed', histErr.message);
    }
  } catch (err) {
    console.error('[video/render] ffmpeg failed', err);
    failJob(renderId, err.message || 'Render failed.');
    refundCredits(entitlement, 1).catch((refundErr) => {
      console.error('[video/render] refund failed', refundErr);
    });
    if (supabaseRow) {
      try {
        const admin = getSupabaseAdmin();
        await admin
          .from('video_renders')
          .update({
            status: 'failed',
            error_message: (err.message || 'render failed').slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq('render_id', renderId);
      } catch {}
    }
  }
}
