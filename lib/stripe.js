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
    name: 'FaceForge Monthly',
    lookupKey: 'faceforge_monthly_v3',
    amountCents: 900, // $9.00 \u2014 unchanged, lookup_key stays _v3
    interval: 'month',
    cap: 6, // credits per month (was 10)
  },
  yearly: {
    name: 'FaceForge Yearly',
    lookupKey: 'faceforge_yearly_v4', // price changed, new key
    amountCents: 8900, // $89.00 (was $69)
    interval: 'year',
    cap: 50, // credits per year (was 100)
  },
};

export const CAPS = {
  trial: 1,
  monthly: PLANS.monthly.cap,
  yearly: PLANS.yearly.cap,
};

export const TRIAL_MS = 24 * 60 * 60 * 1000;

/*
 * One-time top-up credit packs. Sold as Stripe one-time prices
 * (not subscriptions). Credits added via pack purchases stack on the
 * user's `creditsRemaining` and never expire at subscription rollover.
 */
export const TOPUPS = {
  s: {
    name: 'FaceForge Credits (9)',
    lookupKey: 'faceforge_credits_9_v1',
    amountCents: 1500, // $15.00
    credits: 9,
  },
  m: {
    name: 'FaceForge Credits (30)',
    lookupKey: 'faceforge_credits_30_v1',
    amountCents: 5000, // $50.00
    credits: 30,
  },
  l: {
    name: 'FaceForge Credits (60)',
    lookupKey: 'faceforge_credits_60_v1',
    amountCents: 10000, // $100.00
    credits: 60,
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
 * ('s'|'m'|'l' key + config), or null if it's not a top-up price.
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
