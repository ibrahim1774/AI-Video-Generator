import crypto from 'crypto';

/*
 * Server-side helper for Meta Conversions API (CAPI).
 *
 * Sends conversion events to Meta over HTTPS with SHA-256-hashed
 * user data so they can be matched to ad clicks. Browser Pixel
 * events fired with the same `event_id` will be deduplicated by
 * Meta within a 7-day window.
 */

const META_GRAPH_VERSION = 'v19.0';

// Hardcoded to match components/MetaPixel.js — update both if it changes.
const META_PIXEL_ID = '26490568997297314';

function sha256(value) {
  if (!value) return undefined;
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase())
    .digest('hex');
}

function getClientIp(req) {
  if (!req) return undefined;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress;
}

/**
 * Fire a single Meta CAPI event. Silently no-ops if the env vars
 * aren't set, so missing config never breaks Stripe / billing.
 */
export async function sendCapiEvent({
  eventName,
  eventId,
  value,
  currency = 'USD',
  email,
  req,
  customData = {},
}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    console.log('[meta-capi] skipping \u2014 META_ACCESS_TOKEN missing');
    return { skipped: true };
  }

  const userData = {
    em: email ? [sha256(email)] : undefined,
    client_ip_address: getClientIp(req),
    client_user_agent: req?.headers?.['user-agent'],
  };
  // Strip undefined keys so Meta doesn't error.
  Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency,
      ...(typeof value === 'number' ? { value } : {}),
      ...customData,
    },
  };

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(
    accessToken
  )}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] }),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error('[meta-capi] failed', { status: r.status, body: body.slice(0, 500) });
      return { ok: false, status: r.status, body };
    }
    console.log('[meta-capi] sent', { eventName, eventId, value });
    return { ok: true };
  } catch (err) {
    console.error('[meta-capi] threw', err.message);
    return { ok: false, error: err.message };
  }
}
