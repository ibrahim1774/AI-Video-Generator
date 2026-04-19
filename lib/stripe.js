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

export const PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY || '';
export const PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY || '';

export const PLAN_BY_PRICE = {
  [PRICE_MONTHLY]: 'monthly',
  [PRICE_YEARLY]: 'yearly',
};

export const CAPS = {
  trial: 2,
  monthly: 40,
  yearly: 200,
};

export const TRIAL_MS = 24 * 60 * 60 * 1000;
