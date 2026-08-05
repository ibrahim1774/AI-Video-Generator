// /api/tracking-data — the data backend for the /tracking dashboard.
// Port of the aibarber.org / primehub.dev endpoint.
//
// Two live sources, joined per ad creative:
//   • SPEND — Meta Marketing API insights for the ad account, per ad per
//     day. Auth: META_ADS_TOKEN (system-user token, ads_read).
//   • CONVERSIONS — Stripe Checkout sessions in the range. Every session
//     this app creates carries ad attribution in its metadata (utm_* /
//     fc_* — stamped from the al_attr / al_attr_f cookies at checkout),
//     so completed sessions ARE the conversion log: no extra database.
//
// Join key: metadata.utm_id == insights ad_id (ads run with
// utm_id={{ad.id}}), falling back to ad name, then campaign name.
// Unattributed sessions come back in their own bucket.
//
// Auth: middleware already requires a Supabase session for /api/*; this
// route additionally requires the caller to be on the admin allowlist.

import { getUserFromRequest } from '../../lib/supabaseServer';

export const config = { maxDuration: 60 };

const DEFAULT_ADMIN_EMAILS = ['ibrahim3709@gmail.com'];
const AD_ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID || 'act_1731743557488859';
const GRAPH = 'https://graph.facebook.com/v21.0';

function adminEmails() {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_ADMIN_EMAILS.map((s) => s.toLowerCase());
}

async function fetchMetaSpend(since, until) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { rows: [], error: 'META_ADS_TOKEN not set in this environment' };
  const rows = [];
  let url =
    `${GRAPH}/${AD_ACCOUNT_ID}/insights?level=ad` +
    `&fields=campaign_name,adset_name,ad_name,ad_id,spend,impressions,clicks` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&time_increment=1&limit=200&access_token=${encodeURIComponent(token)}`;
  // Follow Graph API paging; hard cap keeps a runaway range from hanging.
  for (let page = 0; url && page < 10; page++) {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.error) return { rows, error: String(data.error.message || 'Meta API error').slice(0, 300) };
    for (const r of data?.data || []) {
      rows.push({
        date: r.date_start || since,
        campaign: r.campaign_name || '',
        adset: r.adset_name || '',
        ad: r.ad_name || '',
        adId: String(r.ad_id || ''),
        spend: parseFloat(r.spend || '0') || 0,
        impressions: parseInt(r.impressions || '0', 10) || 0,
        clicks: parseInt(r.clicks || '0', 10) || 0,
      });
    }
    url = data?.paging?.next || '';
  }
  return { rows };
}

async function fetchStripeConversions(fromUnix, toUnix) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { rows: [], error: 'STRIPE_SECRET_KEY not set' };
  const rows = [];
  let startingAfter = '';
  // Sessions are listed newest-first; page until we pass the range floor.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: '100', 'created[gte]': String(fromUnix), 'created[lte]': String(toUnix) });
    if (startingAfter) params.set('starting_after', startingAfter);
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    if (data?.error) return { rows, error: String(data.error.message || 'Stripe error').slice(0, 300) };
    const batch = data?.data || [];
    for (const s of batch) {
      if (s.status !== 'complete') continue; // only real conversions
      const m = s.metadata || {};
      rows.push({
        id: s.id,
        created: s.created,
        amount: (s.amount_total || 0) / 100,
        currency: (s.currency || 'usd').toUpperCase(),
        plan: m.plan || m.pack || '',
        type: s.mode || '',
        status: s.status,
        customerEmail: s.customer_details?.email || null,
        campaign: m.utm_campaign || m.tw_campaign || '',
        adset: m.utm_adset || '',
        ad: m.utm_content || '',
        adId: String(m.utm_id || m.tw_adid || ''),
        // first-touch set (fc_ prefix) — the ad that first brought them
        fcCampaign: m.fc_utm_campaign || '',
        fcAdset: m.fc_utm_adset || '',
        fcAd: m.fc_utm_content || '',
        fcAdId: String(m.fc_utm_id || ''),
        fbclid: !!m.fbclid,
      });
    }
    if (!data?.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1].id;
  }
  return { rows };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Not signed in' });
  const callerEmail = (session.user.email || '').toLowerCase();
  if (!adminEmails().includes(callerEmail)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // ── range: unix seconds, defaults to the last 7 days ──
  const now = Math.floor(Date.now() / 1000);
  const from = parseInt(String(req.query.from || ''), 10) || now - 7 * 86400;
  const to = parseInt(String(req.query.to || ''), 10) || now;
  const fmt = (u) => new Date(u * 1000).toISOString().slice(0, 10);

  const [meta, stripe] = await Promise.all([
    fetchMetaSpend(fmt(from), fmt(to)),
    fetchStripeConversions(from, to),
  ]);

  return res.status(200).json({
    range: { from, to },
    adAccount: AD_ACCOUNT_ID,
    spend: meta.rows,
    spendError: meta.error || null,
    conversions: stripe.rows,
    conversionsError: stripe.error || null,
  });
}
