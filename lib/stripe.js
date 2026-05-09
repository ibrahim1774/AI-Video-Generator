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
    name: 'Haelabs Monthly',
    lookupKey: 'faceforge_monthly_v4',
    amountCents: 500, // $5.00
    interval: 'month',
    cap: 4, // credits per month
  },
  yearly: {
    name: 'Haelabs Yearly',
    lookupKey: 'faceforge_yearly_v6', // $29 + 28 credits — bumped from v5 ($49/48cr).
    amountCents: 2900, // $29.00
    interval: 'year',
    cap: 28, // credits per year — slight discount per-credit vs monthly.
  },
};

export const TRIAL_CREDITS = 2; // legacy free-trial pool (kept for any old trialing subs).

export const CAPS = {
  trial: TRIAL_CREDITS,
  monthly: PLANS.monthly.cap,
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
  // ── Video credit packs (legacy keys 's','m','l' kept for
  // backwards-compat with existing /api/checkout callers and Paywall).
  s: {
    kind: 'video',
    name: 'Haelabs Video Credits (12)',
    lookupKey: 'faceforge_credits_9_v1', // Stripe price unchanged; credit count rebalanced.
    amountCents: 1500, // $15.00
    credits: 12,
  },
  m: {
    kind: 'video',
    name: 'Haelabs Video Credits (45)',
    lookupKey: 'faceforge_credits_30_v1',
    amountCents: 5000, // $50.00
    credits: 45,
  },
  l: {
    kind: 'video',
    name: 'Haelabs Video Credits (100)',
    lookupKey: 'faceforge_credits_60_v1',
    amountCents: 10000, // $100.00
    credits: 100,
  },
  // ── Image credit packs (Glow Up). Pricing reflects the much lower
  // unit cost of kie.ai 4o-image (~$0.03/image) — packs stack many
  // more credits per dollar than video packs.
  'image-s': {
    kind: 'image',
    name: 'Haelabs Image Credits (50)',
    lookupKey: 'faceforge_image_credits_50_v1',
    amountCents: 500, // $5.00
    credits: 50,
  },
  'image-m': {
    kind: 'image',
    name: 'Haelabs Image Credits (200)',
    lookupKey: 'faceforge_image_credits_200_v1',
    amountCents: 1500, // $15.00
    credits: 200,
  },
  'image-l': {
    kind: 'image',
    name: 'Haelabs Image Credits (500)',
    lookupKey: 'faceforge_image_credits_500_v1',
    amountCents: 3000, // $30.00
    credits: 500,
  },
};

const priceCache = new Map(); // plan -> price object

/**
 * Returns an active Stripe Price for the given plan, creating the
 * Product + Price the first time it's needed. Idempotent — uses
 * `lookup_key` so we don't create duplicates across deploys.
 */
export async function getOrCreatePrice(plan) {
  const config = PLANS[plan];
  if (!config) throw new Error(`Unknown plan: ${plan}`);

  if (priceCache.has(plan)) return priceCache.get(plan);

  const existing = await stripe().prices.list({
    lookup_keys: [config.lookupKey],
    limit: 1,
    active: true,
    expand: ['data.product'],
  });

  if (existing.data.length > 0) {
    priceCache.set(plan, existing.data[0]);
    return existing.data[0];
  }

  const product = await stripe().products.create({
    name: config.name,
    metadata: { plan },
  });

  const price = await stripe().prices.create({
    product: product.id,
    lookup_key: config.lookupKey,
    unit_amount: config.amountCents,
    currency: 'usd',
    recurring: { interval: config.interval },
  });

  priceCache.set(plan, price);
  return price;
}

/**
 * Given a Stripe Price ID or expanded Price, return our internal
 * plan name ('monthly'|'yearly'|null) by matching its lookup_key.
 */
export function planFromPrice(priceOrId) {
  const lookup =
    typeof priceOrId === 'string' ? null : priceOrId?.lookup_key || null;
  if (!lookup) return null;
  for (const [name, cfg] of Object.entries(PLANS)) {
    if (cfg.lookupKey === lookup) return name;
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
