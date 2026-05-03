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
 * Paid 1-day trial price for the yearly plan. Customer is billed $1
 * upfront on a $1/day recurring subscription; a Stripe Subscription
 * Schedule (created server-side after the first invoice is paid) caps
 * phase 1 at 1 iteration and adds phase 2 = the regular yearly price.
 * After 24h, Stripe transitions to phase 2 and bills $49/year.
 */
export const TRIAL_DAY = {
  name: 'Haelabs 1-Day Trial',
  lookupKey: 'faceforge_trial_day_v1',
  amountCents: 100, // $1.00
  interval: 'day',
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
 * plan name ('monthly'|'yearly'|'trial-day'|null) by matching its
 * lookup_key. 'trial-day' indicates the customer is in the paid
 * 1-day trial phase; the entitlement reader treats it as a yearly
 * trialing sub.
 */
export function planFromPrice(priceOrId) {
  const lookup =
    typeof priceOrId === 'string' ? null : priceOrId?.lookup_key || null;
  if (!lookup) return null;
  if (lookup === TRIAL_DAY.lookupKey) return 'trial-day';
  for (const [name, cfg] of Object.entries(PLANS)) {
    if (cfg.lookupKey === lookup) return name;
  }
  return null;
}

let trialDayPriceCache = null;

/**
 * Get or create the $1/day Stripe Price used for the paid 1-day
 * trial. Idempotent via lookup_key.
 */
export async function getOrCreateTrialDayPrice() {
  if (trialDayPriceCache) return trialDayPriceCache;

  const existing = await stripe().prices.list({
    lookup_keys: [TRIAL_DAY.lookupKey],
    limit: 1,
    active: true,
    expand: ['data.product'],
  });
  if (existing.data.length > 0) {
    trialDayPriceCache = existing.data[0];
    return trialDayPriceCache;
  }

  const product = await stripe().products.create({
    name: TRIAL_DAY.name,
    metadata: { plan: 'trial-day' },
  });
  const price = await stripe().prices.create({
    product: product.id,
    lookup_key: TRIAL_DAY.lookupKey,
    unit_amount: TRIAL_DAY.amountCents,
    currency: 'usd',
    recurring: { interval: TRIAL_DAY.interval },
  });
  trialDayPriceCache = price;
  return price;
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
