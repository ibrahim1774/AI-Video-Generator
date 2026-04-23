import { getUserFromRequest, getSupabaseAdmin } from '../../lib/supabaseServer';
import { sendCapiEvent } from '../../lib/meta';

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    // First hop is the real client; the rest are proxies.
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

/*
 * Records the caller's IP keyed by their Supabase user_id. Idempotent —
 * second call for the same user is a no-op. Also returns whether the
 * IP is shared with any other user, which the client uses to show a
 * "someone on this network already used the free trial" note.
 *
 * The authoritative enforcement happens server-side in /api/checkout
 * at trial-grant time; this endpoint is advisory only.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const ip = clientIp(req);
  if (!ip) return res.status(200).json({ recorded: false, trialEligible: true });

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    console.warn('[signup-ip] admin client unavailable', err.message);
    return res.status(200).json({ recorded: false, trialEligible: true });
  }

  // Check if anyone else has already bound this IP.
  const { data: existing, error: selErr } = await admin
    .from('signup_ips')
    .select('user_id')
    .eq('ip', ip);
  if (selErr) {
    console.warn('[signup-ip] select failed', selErr.message);
    return res.status(200).json({ recorded: false, trialEligible: true });
  }

  const sharedWithOther =
    Array.isArray(existing) && existing.some((row) => row.user_id !== session.user.id);

  // Upsert our own row. If the IP is already owned by someone else the
  // unique index on (ip) will reject the insert — that's fine; we swallow
  // the error and just report the flag back.
  const { error: upErr } = await admin
    .from('signup_ips')
    .upsert({ user_id: session.user.id, ip }, { onConflict: 'user_id' });

  if (upErr && !/duplicate key|unique/i.test(upErr.message)) {
    console.warn('[signup-ip] upsert failed', upErr.message);
  }

  // Fire CompleteRegistration via CAPI on first record only (i.e. when
  // this user_id wasn't already in the table). The client dedupes the
  // matching browser-pixel event via the returned eventId.
  let meta = null;
  const isNewSignup =
    !sharedWithOther
      ? !(Array.isArray(existing) && existing.some((row) => row.user_id === session.user.id))
      : false;
  if (isNewSignup) {
    const eventId = `reg-${session.user.id}`;
    sendCapiEvent({
      eventName: 'CompleteRegistration',
      eventId,
      email: session.user.email,
      req,
      customData: { supabase_user_id: session.user.id },
    }).catch(() => {});
    meta = { eventName: 'CompleteRegistration', eventId };
  }

  return res
    .status(200)
    .json({ recorded: true, trialEligible: !sharedWithOther, meta });
}
