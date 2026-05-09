import { put } from '@vercel/blob';

import { getUserFromRequest, getSupabaseAdmin } from '../../lib/supabaseServer';
import { stripe } from '../../lib/stripe';

/*
 * AI Interior Design generation endpoint.
 *
 * Same architecture as /api/glow-up:
 *   - Auth: Supabase via getUserFromRequest
 *   - Entitlement: imageCreditsRemaining pool on Stripe customer
 *     metadata (30 / 30 days, plus image-pack top-ups). NEVER falls
 *     back to the video credit pool.
 *   - Charge: inline reserve-then-refund (no call to a non-existent
 *     recordUsage()).
 *   - Compute: kie.ai's unified jobs API with model = 'flux_kontext',
 *     image-to-image with one reference photo. Result mirrored to
 *     Vercel Blob via put().
 */

const PERIOD_DAYS = 30;
const CREDITS_PER_PERIOD = 30;
const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_GENERATE_PATH = '/jobs/createTask';
const KIE_RECORD_PATH = '/jobs/recordInfo';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120 * 1000;

const STYLE_PROMPTS = {
  'modern-minimalist':
    'Transform into a modern minimalist interior. Clean lines, neutral whites and greys, uncluttered surfaces, hidden storage, statement lighting.',
  scandinavian:
    'Transform into a Scandinavian hygge interior. Light wood tones, white walls, cozy textiles, natural materials, warm ambient lighting.',
  'industrial-loft':
    'Transform into an industrial loft interior. Exposed brick, steel beams, concrete surfaces, Edison bulb pendants, dark metal fixtures.',
  bohemian:
    'Transform into a bohemian eclectic interior. Rich jewel tones, layered textiles, rattan furniture, plants, global-inspired patterns.',
  'mid-century-modern':
    'Transform into a mid-century modern interior. Organic curves, walnut wood, mustard and teal accents, retro furniture silhouettes, sunburst details.',
  japandi:
    'Transform into a Japandi interior. Wabi-sabi minimalism, warm neutrals, natural linen and stone, low-profile furniture, zen simplicity.',
  coastal:
    'Transform into a coastal beach house interior. Soft blues and whites, natural rattan, linen fabrics, whitewashed wood, breezy open feel.',
  'dark-moody':
    'Transform into a dark moody interior. Deep charcoal and forest green walls, velvet furniture, brass accents, dramatic lighting, rich layered textures.',
};

// Server-side source of truth for the shoppable product grid. The
// page imports an identical map for instant rendering, but the API
// response's `products` is what the UI ultimately renders so a
// tampered client can't inject arbitrary names.
const STYLE_PRODUCTS = {
  'modern-minimalist': [
    'platform bed frame',
    'linen sofa',
    'arc floor lamp',
    'floating wall shelf',
    'concrete planter',
    'glass dining table',
    'bar stool set',
    'abstract wall art',
  ],
  scandinavian: [
    'light oak coffee table',
    'sheepskin throw',
    'pendant rattan lamp',
    'linen curtains',
    'storage bench',
    'ceramic vase set',
    'wool area rug',
    'wooden wall clock',
  ],
  'industrial-loft': [
    'metal bookshelf',
    'leather sofa',
    'Edison pendant light',
    'pipe clothing rack',
    'metal bar stool',
    'distressed wood dining table',
    'concrete lamp',
    'vintage wall map',
  ],
  bohemian: [
    'macrame wall hanging',
    'rattan chair',
    'floor pouf ottoman',
    'indoor hanging planter',
    'kilim rug',
    'velvet throw pillow set',
    'moroccan lantern',
    'cane side table',
  ],
  'mid-century-modern': [
    'walnut credenza',
    'tulip dining table',
    'egg chair',
    'sunburst mirror',
    'tapered leg sofa',
    'retro floor lamp',
    'teak side table',
    'geometric area rug',
  ],
  japandi: [
    'low platform bed',
    'bamboo floor lamp',
    'linen storage basket',
    'ceramic tea set',
    'neutral wool rug',
    'shoji screen divider',
    'solid wood bench',
    'simple white duvet',
  ],
  coastal: [
    'rattan pendant light',
    'blue stripe throw pillow',
    'whitewashed dresser',
    'jute area rug',
    'sea glass candle set',
    'rope mirror',
    'linen sofa slipcover',
    'driftwood wall art',
  ],
  'dark-moody': [
    'velvet sofa',
    'brass floor lamp',
    'dark linen curtains',
    'antique mirror',
    'forest green accent chair',
    'marble side table',
    'gallery wall frame set',
    'emerald throw blanket',
  ],
};

const KEEP_FURNITURE_PROMPTS = {
  blend: 'Keep existing furniture and blend the new style around it.',
  redesign: 'Full redesign — replace existing furniture with new pieces.',
};

const BUDGET_PROMPTS = {
  luxury: 'Luxury high-end finishes and materials.',
  'mid-range': 'Mid-range tasteful finishes and materials.',
  'budget-friendly': 'Budget-friendly approachable materials and finishes.',
};

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'ibrahim3709@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isPaidPlan(plan) {
  return plan === 'monthly' || plan === 'yearly';
}

function safePromptFragment(s, max = 400) {
  if (typeof s !== 'string') return '';
  // Filter ASCII control chars (0-31, 127) by codepoint, collapse
  // whitespace, cap length.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 32 || c === 127 ? ' ' : s[i];
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Sign in first.' });

  const userEmail = (session.user.email || '').toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(userEmail);

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', session.user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id || null;

  let entitlement;
  if (isAdmin) {
    entitlement = {
      tier: 'admin',
      status: 'admin',
      imageCreditsRemaining: 9999,
      nextPeriodStart: Date.now(),
      md: null,
      activeSub: { id: 'admin' },
    };
  } else {
    entitlement = await resolveEntitlement(customerId);
  }

  // Validate body.
  const body = req.body || {};
  const { imageUrl, style, userPrompt, keepFurniture, budgetFeel } = body;
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Valid imageUrl is required.' });
  }
  if (!STYLE_PROMPTS[style]) {
    return res.status(400).json({ error: 'Invalid style.' });
  }
  const keep = keepFurniture === 'blend' || keepFurniture === 'redesign'
    ? keepFurniture
    : 'redesign';
  const budget =
    budgetFeel === 'luxury' || budgetFeel === 'mid-range' || budgetFeel === 'budget-friendly'
      ? budgetFeel
      : 'mid-range';

  if (!isAdmin && (entitlement.tier === 'none' || !entitlement.activeSub)) {
    return res.status(402).json({ error: 'paywall' });
  }

  let { imageCreditsRemaining: imageCredits } = entitlement;
  if (!isAdmin) {
    if (imageCredits > 0) {
      imageCredits -= 1;
    } else {
      return res
        .status(402)
        .json({ error: 'paywall', reason: 'image-credits-exhausted' });
    }
  }

  // Reserve credit BEFORE calling kie.ai. Refund on every failure path
  // below.
  let creditReserved = false;
  if (!isAdmin && customerId && entitlement.md) {
    const reservedMd = { ...entitlement.md };
    reservedMd.imageCreditsRemaining = String(imageCredits);
    reservedMd.imagePeriodStart = String(entitlement.nextPeriodStart);
    try {
      await stripe().customers.update(customerId, { metadata: reservedMd });
      creditReserved = true;
    } catch (mdErr) {
      console.warn('[interior-design] credit reserve failed', mdErr.message);
      return res.status(500).json({ error: 'Could not reserve credit.' });
    }
  }

  const kieKey = process.env.KIE_API_KEY;
  if (!kieKey) {
    if (creditReserved) await refundCredit({ customerId, isAdmin, md: entitlement.md, nextPeriodStart: entitlement.nextPeriodStart });
    return res.status(500).json({ error: 'KIE_API_KEY is not configured.' });
  }

  // Build the kie.ai prompt.
  const userFragment = safePromptFragment(userPrompt, 400);
  const promptParts = [
    STYLE_PROMPTS[style],
    userFragment ? `Additional user direction: ${userFragment}` : '',
    KEEP_FURNITURE_PROMPTS[keep],
    BUDGET_PROMPTS[budget],
    'Photorealistic architectural interior photography, natural lighting, high detail, 4K quality.',
  ].filter(Boolean);
  const kiePrompt = promptParts.join(' ');

  try {
    // 1. Create the kie.ai flux_kontext task via the unified jobs API.
    const createRes = await fetch(`${KIE_BASE}${KIE_GENERATE_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kieKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'flux_kontext',
        input: {
          prompt: kiePrompt,
          medias: [{ role: 'image', value: imageUrl }],
          aspect_ratio: '4:3',
        },
      }),
    });
    const createText = await createRes.text();
    let createData;
    try {
      createData = JSON.parse(createText);
    } catch {
      createData = { code: createRes.status, msg: createText };
    }
    if (!createRes.ok || createData.code !== 200 || !createData.data?.taskId) {
      console.error(
        '[interior-design] kie.ai create failed',
        createRes.status,
        createText.slice(0, 500)
      );
      if (creditReserved) await refundCredit({ customerId, isAdmin, md: entitlement.md, nextPeriodStart: entitlement.nextPeriodStart });
      return res.status(502).json({ error: createData?.msg || 'Generation failed.' });
    }
    const taskId = createData.data.taskId;

    // 2. Poll recordInfo until success / fail / timeout. Defensive
    // result-URL parsing matches lib/kie.js normalizeKieStatus.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let resultUrl = null;
    let lastErr = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const recRes = await fetch(
        `${KIE_BASE}${KIE_RECORD_PATH}?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${kieKey}` } }
      );
      const recText = await recRes.text();
      let rec;
      try {
        rec = JSON.parse(recText);
      } catch {
        continue;
      }
      if (rec.code !== 200) continue;
      const state = String(rec.data?.state || '').toLowerCase();
      if (state === 'success' || state === 'succeed' || state === 'completed') {
        const raw = rec.data?.resultJson;
        let parsed = null;
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          parsed = null;
        }
        if (parsed) {
          resultUrl =
            parsed.imageUrl ||
            parsed.image_url ||
            (Array.isArray(parsed.imageUrls) ? parsed.imageUrls[0] : null) ||
            (Array.isArray(parsed.resultUrls) ? parsed.resultUrls[0] : null) ||
            parsed.url ||
            null;
        }
        break;
      }
      if (state === 'fail' || state === 'failed' || state === 'error') {
        lastErr = rec.data?.failMsg || rec.data?.failCode || 'Generation failed.';
        break;
      }
      // state is waiting / generating / unknown — keep polling.
    }

    if (!resultUrl) {
      if (creditReserved) await refundCredit({ customerId, isAdmin, md: entitlement.md, nextPeriodStart: entitlement.nextPeriodStart });
      return res.status(502).json({ error: lastErr || 'Generation timed out.' });
    }

    // 3. Mirror to Vercel Blob so the resulting URL is on our infra
    // (stable + same-origin-safe for canvas readback in the share flow).
    let storedUrl;
    try {
      const dlRes = await fetch(resultUrl);
      if (!dlRes.ok) throw new Error(`Could not fetch generated image (${dlRes.status}).`);
      const ab = await dlRes.arrayBuffer();
      const ct = dlRes.headers.get('content-type') || 'image/png';
      const ext = ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'png';
      const stored = await put(`interior-design/${Date.now()}.${ext}`, Buffer.from(ab), {
        access: 'public',
        contentType: ct,
        addRandomSuffix: true,
      });
      storedUrl = stored.url;
    } catch (mirrorErr) {
      console.warn('[interior-design] mirror upload failed; serving kie.ai URL', mirrorErr.message);
      storedUrl = resultUrl;
    }

    return res.status(200).json({
      renderedImageUrl: storedUrl,
      products: STYLE_PRODUCTS[style] || [],
      imageCreditsRemaining: isAdmin ? 9999 : imageCredits,
    });
  } catch (err) {
    console.error('[interior-design] failed', err);
    if (creditReserved) await refundCredit({ customerId, isAdmin, md: entitlement.md, nextPeriodStart: entitlement.nextPeriodStart });
    return res.status(500).json({ error: err.message || 'Generation failed.' });
  }
}

async function refundCredit({ customerId, isAdmin, md, nextPeriodStart }) {
  if (isAdmin || !customerId || !md) return;
  try {
    const fresh = await stripe().customers.retrieve(customerId);
    const freshMd = fresh && !fresh.deleted ? fresh.metadata || {} : {};
    const next = { ...freshMd };
    const cur = parseInt(freshMd.imageCreditsRemaining || '0', 10) || 0;
    next.imageCreditsRemaining = String(cur + 1);
    if (next.imagePeriodStart == null) {
      next.imagePeriodStart = String(nextPeriodStart);
    }
    await stripe().customers.update(customerId, { metadata: next });
  } catch (refundErr) {
    console.warn('[interior-design] refund failed', refundErr.message);
  }
}

async function resolveEntitlement(customerId) {
  const empty = {
    tier: 'none',
    status: 'none',
    imageCreditsRemaining: 0,
    nextPeriodStart: Date.now(),
    md: null,
    activeSub: null,
  };
  if (!customerId) return empty;

  const customer = await stripe().customers.retrieve(customerId);
  if (!customer || customer.deleted) return empty;
  const md = customer.metadata || {};
  const plan = md.plan || null;

  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 5,
  });
  const activeSub = subs.data.find(
    (s) => s.status === 'active' || s.status === 'trialing'
  );
  const status = activeSub?.status || 'none';

  if (!isPaidPlan(plan) || !activeSub) {
    return { ...empty, tier: plan || 'none', status, md };
  }

  const now = Date.now();
  const periodStart = parseInt(md.imagePeriodStart || '0', 10) || 0;
  let imageCredits = parseInt(md.imageCreditsRemaining || '0', 10) || 0;
  let nextPeriodStart = periodStart;
  if (!periodStart || now - periodStart >= PERIOD_MS) {
    imageCredits = CREDITS_PER_PERIOD;
    nextPeriodStart = now;
  }

  return {
    tier: plan,
    status,
    imageCreditsRemaining: imageCredits,
    nextPeriodStart,
    md,
    activeSub,
  };
}
