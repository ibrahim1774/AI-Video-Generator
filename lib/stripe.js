import Stripe from 'stripe';

let cached = null;

export function stripe() {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set.');
  }
  cached = new Stripe(key, { apiVersion: '2024-06-20' });
  return cached;
}

export const PLANS = {
  monthly: {
    name: 'Ariya Lab Monthly',
    // Distinct lookup key — Haelabs's planFromPrice doesn't recognise
    // this, so its webhook handler no-ops on ariyalab subscriptions.
    lookupKey: 'ariyalab_monthly_v1',
    amountCents: 500, // $5.00
    interval: 'month',
    // 760 credits = 76 seconds of Seedance 1.5 Pro 480p no-audio
    // (10 cr/sec baseline). Ibrahim's cost target ≤ $1 at full burn.
    cap: 760,
  },
  pro: {
    name: 'Ariya Lab Pro',
    lookupKey: 'ariyalab_pro_v1',
    amountCents: 900, // $9.00
    interval: 'month',
    // 2,280 credits = 228 seconds at 480p no-audio. Ibrahim's cost
    // target ≤ $3 at full burn.
    cap: 2280,
  },
  yearly: {
    name: 'Ariya Lab Yearly',
    lookupKey: 'ariyalab_yearly_v1',
    amountCents: 2900, // $29.00
    interval: 'year',
    // 3,840 credits = 384 seconds at 480p no-audio. Ibrahim's cost
    // target ≤ $5 at full burn. Per-credit slightly cheaper than
    // monthly (3840 vs 760×12=9120) — modest loyalty discount.
    cap: 3840,
  },
};

export const TRIAL_CREDITS = 2; // legacy free-trial pool (kept for any old trialing subs).

export const CAPS = {
  trial: TRIAL_CREDITS,
  monthly: PLANS.monthly.cap,
  pro: PLANS.pro.cap,
  yearly: PLANS.yearly.cap,
};

export const TRIAL_MS = 24 * 60 * 60 * 1000;

/*
 * One-time top-up credit packs. Sold as Stripe one-time prices
 * (not subscriptions). Two distinct kinds:
 *
 *   - kind: 'video' — credits the existing `creditsRemaining` pool used
 *     by face-swap / UGC / image-to-video.
 *   - kind: 'image' — credits the `imageCreditsRemaining` pool used by
 *     /api/glow-up (and any future image features).
 *
 * The two pools never mix: a customer who buys an image pack cannot
 * spend those credits on video features, and vice versa.
 */
export const TOPUPS = {
  // ── Video credit packs. Distinct lookup keys so Haelabs's webhook
  // handler returns null on topupFromPrice and no-ops on ariyalab events.
  s: {
    kind: 'video',
    name: 'Ariya Lab Video Credits (2,280)',
    lookupKey: 'ariyalab_topup_video_s_v1',
    amountCents: 1500, // $15.00
    credits: 2280,
  },
  m: {
    kind: 'video',
    name: 'Ariya Lab Video Credits (7,600)',
    lookupKey: 'ariyalab_topup_video_m_v1',
    amountCents: 5000, // $50.00
    credits: 7600,
  },
  l: {
    kind: 'video',
    name: 'Ariya Lab Video Credits (15,200)',
    lookupKey: 'ariyalab_topup_video_l_v1',
    amountCents: 10000, // $100.00
    credits: 15200,
  },
  // ── Image credit packs (Glow Up / Interior Design). Pricing reflects
  // the much lower unit cost of kie.ai 4o-image / Flux Kontext
  // (~$0.03/image). Distinct lookup keys for ariyalab isolation.
  'image-s': {
    kind: 'image',
    name: 'Ariya Lab Image Credits (50)',
    lookupKey: 'ariyalab_topup_image_s_v1',
    amountCents: 500, // $5.00
    credits: 50,
  },
  'image-m': {
    kind: 'image',
    name: 'Ariya Lab Image Credits (200)',
    lookupKey: 'ariyalab_topup_image_m_v1',
    amountCents: 1500, // $15.00
    credits: 200,
  },
  'image-l': {
    kind: 'image',
    name: 'Ariya Lab Image Credits (500)',
    lookupKey: 'ariyalab_topup_image_l_v1',
    amountCents: 3000, // $30.00
    credits: 500,
  },
};

/*
 * Per-surface variants of each subscription plan. SAME PRICE, SAME
 * ENTITLEMENT — only the Stripe Product NAME differs so the checkout
 * page header reads the right label for the surface the customer
 * came from. Every variant maps back to the same internal plan
 * ('monthly' or 'yearly') via planFromPrice, so the rest of the app
 * (entitlement, credits, top-ups, webhook handlers) is unchanged.
 *
 * The 'default' variant keeps the legacy lookup keys exactly so any
 * existing customer's subscription continues to map cleanly.
 */
export const PLAN_SURFACES = {
  monthly: {
    default: { lookupKey: PLANS.monthly.lookupKey, productName: PLANS.monthly.name },
    'glow-up': {
      lookupKey: 'ariyalab_monthly_glow_up_v1',
      productName: 'Glow Up Monthly Plan',
    },
    'interior-design': {
      lookupKey: 'ariyalab_monthly_interior_v1',
      productName: 'AI Interior Monthly Plan',
    },
    'local-business': {
      lookupKey: 'ariyalab_monthly_local_business_v1',
      productName: 'Local Business Monthly Plan',
    },
    'real-estate': {
      lookupKey: 'ariyalab_monthly_real_estate_v1',
      productName: 'Real Estate Monthly Plan',
    },
  },
  pro: {
    default: { lookupKey: PLANS.pro.lookupKey, productName: PLANS.pro.name },
    'glow-up': {
      lookupKey: 'ariyalab_pro_glow_up_v1',
      productName: 'Glow Up Pro Plan',
    },
    'interior-design': {
      lookupKey: 'ariyalab_pro_interior_v1',
      productName: 'AI Interior Pro Plan',
    },
    'local-business': {
      lookupKey: 'ariyalab_pro_local_business_v1',
      productName: 'Local Business Pro Plan',
    },
    'real-estate': {
      lookupKey: 'ariyalab_pro_real_estate_v1',
      productName: 'Real Estate Pro Plan',
    },
  },
  yearly: {
    default: { lookupKey: PLANS.yearly.lookupKey, productName: PLANS.yearly.name },
    'glow-up': {
      lookupKey: 'ariyalab_yearly_glow_up_v1',
      productName: 'Glow Up Yearly Plan',
    },
    'interior-design': {
      lookupKey: 'ariyalab_yearly_interior_v1',
      productName: 'AI Interior Yearly Plan',
    },
    'local-business': {
      lookupKey: 'ariyalab_yearly_local_business_v1',
      productName: 'Local Business Yearly Plan',
    },
    'real-estate': {
      lookupKey: 'ariyalab_yearly_real_estate_v1',
      productName: 'Real Estate Yearly Plan',
    },
  },
};

const priceCache = new Map(); // `${plan}:${surface}` -> price object

/**
 * Returns an active Stripe Price for the given plan + surface,
 * creating the Product + Price the first time it's needed.
 * Idempotent — uses `lookup_key` so we don't create duplicates
 * across deploys. When `surface` is omitted or unknown, falls back
 * to the 'default' variant (the legacy Ariya Lab Monthly / Yearly).
 */
export async function getOrCreatePrice(plan, surface = 'default') {
  const planCfg = PLANS[plan];
  if (!planCfg) throw new Error(`Unknown plan: ${plan}`);
  const surfaces = PLAN_SURFACES[plan] || {};
  const variant = surfaces[surface] || surfaces.default;
  if (!variant) throw new Error(`No variant for ${plan}/${surface}`);

  const cacheKey = `${plan}:${surface in surfaces ? surface : 'default'}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);

  const existing = await stripe().prices.list({
    lookup_keys: [variant.lookupKey],
    limit: 1,
    active: true,
    expand: ['data.product'],
  });

  if (existing.data.length > 0) {
    priceCache.set(cacheKey, existing.data[0]);
    return existing.data[0];
  }

  const product = await stripe().products.create({
    name: variant.productName,
    metadata: { plan, surface: surface in surfaces ? surface : 'default' },
  });

  const price = await stripe().prices.create({
    product: product.id,
    lookup_key: variant.lookupKey,
    unit_amount: planCfg.amountCents,
    currency: 'usd',
    recurring: { interval: planCfg.interval },
  });

  priceCache.set(cacheKey, price);
  return price;
}

/**
 * Given a Stripe Price ID or expanded Price, return our internal
 * plan name ('monthly'|'yearly'|null) by matching its lookup_key.
 * Recognizes both the legacy lookup keys (PLANS.{plan}.lookupKey)
 * and every per-surface variant lookup key, so a customer who
 * subscribed via "Glow Up Monthly Plan" still resolves to 'monthly'.
 */
export function planFromPrice(priceOrId) {
  const lookup =
    typeof priceOrId === 'string' ? null : priceOrId?.lookup_key || null;
  if (!lookup) return null;
  // Legacy direct match against PLANS.
  for (const [name, cfg] of Object.entries(PLANS)) {
    if (cfg.lookupKey === lookup) return name;
  }
  // Per-surface variants — all roll up to the same plan name.
  for (const [planName, surfaces] of Object.entries(PLAN_SURFACES)) {
    for (const variant of Object.values(surfaces)) {
      if (variant.lookupKey === lookup) return planName;
    }
  }
  return null;
}


/**
 * Given a Stripe Price (expanded), return the top-up pack config
 * (key + config including `kind: 'video' | 'image'`), or null if it's
 * not one of our top-up prices.
 */
export function topupFromPrice(priceOrId) {
  const lookup =
    typeof priceOrId === 'string' ? null : priceOrId?.lookup_key || null;
  if (!lookup) return null;
  for (const [key, cfg] of Object.entries(TOPUPS)) {
    if (cfg.lookupKey === lookup) return { key, ...cfg };
  }
  return null;
}

const topupPriceCache = new Map();

/**
 * Idempotently get or create a one-time Stripe Price for a top-up pack.
 * Mirrors getOrCreatePrice but without a recurring interval.
 */
export async function getOrCreateTopupPrice(packKey) {
  const config = TOPUPS[packKey];
  if (!config) throw new Error(`Unknown top-up pack: ${packKey}`);

  if (topupPriceCache.has(packKey)) return topupPriceCache.get(packKey);

  const existing = await stripe().prices.list({
    lookup_keys: [config.lookupKey],
    limit: 1,
    active: true,
    expand: ['data.product'],
  });

  if (existing.data.length > 0) {
    topupPriceCache.set(packKey, existing.data[0]);
    return existing.data[0];
  }

  const product = await stripe().products.create({
    name: config.name,
    metadata: { topup: packKey, credits: String(config.credits) },
  });

  const price = await stripe().prices.create({
    product: product.id,
    lookup_key: config.lookupKey,
    unit_amount: config.amountCents,
    currency: 'usd',
    // No `recurring` — one-time payment.
  });

  topupPriceCache.set(packKey, price);
  return price;
}
