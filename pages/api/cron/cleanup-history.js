import { del } from '@vercel/blob';

import { getSupabaseAdmin } from '../../../lib/supabaseServer';

/*
 * Daily cron — deletes expired history rows and their owned blobs.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` (the
 * env var is auto-injected by Vercel). We verify it before running.
 *
 * Safe to call manually for testing:
 *   curl -X POST .../api/cron/cleanup-history -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(req, res) {
  // Vercel Cron sends GET by default. Allow both.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const admin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('videos')
      .select('id, result_url, is_blob_owned')
      .lt('expires_at', nowIso)
      .limit(500);
    if (error) {
      console.error('[cron/cleanup-history] select failed', error.message);
      return res.status(500).json({ error: 'Select failed.' });
    }
    const rows = data || [];
    if (rows.length === 0) {
      return res.status(200).json({ deletedRows: 0, deletedBlobs: 0 });
    }

    // Delete owned blobs in parallel. Failures are non-fatal —
    // missing blobs are fine; we still want to clean up the rows.
    const blobUrls = rows.filter((r) => r.is_blob_owned && r.result_url).map((r) => r.result_url);
    let deletedBlobs = 0;
    if (blobUrls.length) {
      const settled = await Promise.allSettled(blobUrls.map((u) => del(u)));
      deletedBlobs = settled.filter((s) => s.status === 'fulfilled').length;
      const failed = settled.filter((s) => s.status === 'rejected');
      if (failed.length) {
        console.warn('[cron/cleanup-history] blob delete failures', failed.length);
      }
    }

    const ids = rows.map((r) => r.id);
    const { error: delErr } = await admin.from('videos').delete().in('id', ids);
    if (delErr) {
      console.error('[cron/cleanup-history] row delete failed', delErr.message);
      return res.status(500).json({ error: 'Row delete failed.' });
    }

    return res.status(200).json({ deletedRows: ids.length, deletedBlobs });
  } catch (err) {
    console.error('[cron/cleanup-history] threw', err);
    return res.status(500).json({ error: err.message || 'Cron failed.' });
  }
}
