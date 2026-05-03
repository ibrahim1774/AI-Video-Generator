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
 * $1 one-time "trial deposit" for the yearly paid 1-day trial flow.
 * Stripe Checkout charges this immediately (one-time line item) AND
 * starts the recurring yearly subscription with trial_period_days=1.
 * After 24h the trial ends and Stripe bills the regular $49/year.
 *
 * Stripe Checkout displays both line items + the renewal schedule on
 * the checkout page natively, which satisfies FTC / Stripe ToS
 * auto-renewal disclosure rules.
 */
export const TRIAL_DEPOSIT = {
  name: 'Haelabs Yearly · 1-Day Trial',
  lookupKey: 'faceforge_trial_deposit_v1',
  amountCents: 100, // $1.00 (one-time)
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

let trialDepositPriceCache = null;

/**
 * Idempotent get-or-create for the $1 one-time trial-deposit Stripe
 * Price. Mirrors getOrCreateTopupPrice. Used as a second line_item
 * alongside the yearly recurring price so Stripe Checkout charges $1
 * upfront and starts the trial in the same session.
 */
export async function getOrCreateTrialDepositPrice() {
  if (trialDepositPriceCache) return trialDepositPriceCache;

  const existing = await stripe().prices.list({
    lookup_keys: [TRIAL_DEPOSIT.lookupKey],
    limit: 1,
    active: true,
    expand: ['data.product'],
  });
  if (existing.data.length > 0) {
    trialDepositPriceCache = existing.data[0];
    return trialDepositPriceCache;
  }

  const product = await stripe().products.create({
    name: TRIAL_DEPOSIT.name,
    metadata: { kind: 'trial-deposit' },
  });
  const price = await stripe().prices.create({
    product: product.id,
    lookup_key: TRIAL_DEPOSIT.lookupKey,
    unit_amount: TRIAL_DEPOSIT.amountCents,
    currency: 'usd',
    // No `recurring` — this is a one-time charge.
  });
  trialDepositPriceCache = price;
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
