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
    lookupKey: 'faceforge_monthly_v1',
    amountCents: 500, // $5.00
    interval: 'month',
    cap: 10,
  },
  yearly: {
    name: 'FaceForge Yearly',
    lookupKey: 'faceforge_yearly_v1',
    amountCents: 3900, // $39.00
    interval: 'year',
    cap: 100,
  },
};

export const CAPS = {
  trial: 1,
  monthly: PLANS.monthly.cap,
  yearly: PLANS.yearly.cap,
};

export const TRIAL_MS = 24 * 60 * 60 * 1000;

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
