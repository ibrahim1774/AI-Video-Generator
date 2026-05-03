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
    lookupKey: 'faceforge_yearly_v5',
    amountCents: 4900, // $49.00
    interval: 'year',
    cap: 48, // credits per year (4 × 12)
  },
};

export const TRIAL_CREDITS = 2; // generations included in the 1-day trial

/*
 * First-year intro coupon for the yearly plan. Customer pays $1 today
 * (= $49 base - $48 coupon) and then auto-renews at $49/year on the
 * normal yearly cadence. Stripe Checkout shows the full breakdown
 * (price, discount, renewal date) on the checkout page itself, which
 * is what FTC + Stripe's auto-renewal disclosure rules require.
 *
 * `duration: 'once'` makes the discount apply only to the first
 * invoice — every renewal after that is full price.
 */
export const INTRO_COUPON = {
  id: 'haelabs_yearly_intro_48_off_v1',
  name: 'Yearly intro: $48 off first year',
  amountOffCents: 4800, // $48.00 → first year nets to $1
};

export const CAPS = {
  trial: TRIAL_CREDITS,
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
    name: 'Haelabs Credits (12)',
    lookupKey: 'faceforge_credits_9_v1', // Stripe price unchanged; credit count rebalanced.
    amountCents: 1500, // $15.00
    credits: 12,
  },
  m: {
    name: 'Haelabs Credits (45)',
    lookupKey: 'faceforge_credits_30_v1',
    amountCents: 5000, // $50.00
    credits: 45,
  },
  l: {
    name: 'Haelabs Credits (100)',
    lookupKey: 'faceforge_credits_60_v1',
    amountCents: 10000, // $100.00
    credits: 100,
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

let introCouponCache = null;

/**
 * Idempotently fetch (or create on first use) the $48-off intro
 * coupon for new yearly subscribers. Stripe coupon IDs are unique
 * per account; we use the same INTRO_COUPON.id every time so a
 * second create() would 409.
 */
export async function getOrCreateIntroCoupon() {
  if (introCouponCache) return introCouponCache;

  try {
    const existing = await stripe().coupons.retrieve(INTRO_COUPON.id);
    introCouponCache = existing;
    return existing;
  } catch (err) {
    if (err.code !== 'resource_missing') throw err;
  }

  const created = await stripe().coupons.create({
    id: INTRO_COUPON.id,
    name: INTRO_COUPON.name,
    amount_off: INTRO_COUPON.amountOffCents,
    currency: 'usd',
    duration: 'once', // applies only to the first invoice
  });
  introCouponCache = created;
  return created;
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
