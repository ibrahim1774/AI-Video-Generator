import { parse, serialize } from 'cookie';

import { stripe, CAPS, planFromPrice } from './stripe';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

export const COOKIES = {
  customer: 'ff_customer',
};

function readCookies(req) {
  const header = req.headers?.cookie || '';
  return parse(header || '');
}

export function setCustomerCookie(res, customerId) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIES.customer, customerId, {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 365,
    })
  );
}

/**
 * Credits-remaining model.
 *
 *   metadata.creditsRemaining   decrements on Banana success, never below 0
 *   metadata.periodStart        subscription period start (ms), used to detect renewals
 *   metadata.plan               'monthly' | 'yearly' — which plan we credited for
 *
 * On a new Stripe current_period_start we *add* the plan's cap to
 * creditsRemaining (don't replace), so unused credits carry over and
 * top-up credits never expire.
 *
 * Legacy migration: if metadata still has videosUsedThisPeriod but
 * no creditsRemaining, we seed creditsRemaining = cap - videosUsed
 * on first read.
 */
async function readPaidEntitlement(customerId) {
  const [active, trialing] = await Promise.all([
    stripe().subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
      expand: ['data.items.data.price'],
    }),
    stripe().subscriptions.list({
      customer: customerId,
      status: 'trialing',
      limit: 1,
      expand: ['data.items.data.price'],
    }),
  ]);
  const sub = active.data[0] || trialing.data[0];
  if (!sub) return null;
  const price = sub.items?.data?.[0]?.price;
  const plan = planFromPrice(price);
  if (!plan) return null;

  const customer = await stripe().customers.retrieve(customerId);
  const md = customer && !customer.deleted ? customer.metadata || {} : {};

  const planCap = CAPS[plan];
  const periodStartMs = (sub.current_period_start || 0) * 1000;
  const storedPeriodStart = parseInt(md.periodStart || '0', 10);

  let creditsRemaining;
  if (md.creditsRemaining !== undefined && md.creditsRemaining !== '') {
    creditsRemaining = Math.max(0, parseInt(md.creditsRemaining, 10) || 0);
  } else if (md.videosUsedThisPeriod !== undefined) {
    // Legacy migration: seed from the old used-counter.
    const used = parseInt(md.videosUsedThisPeriod, 10) || 0;
    creditsRemaining = Math.max(0, planCap - used);
  } else {
    creditsRemaining = planCap;
  }

  // Detect subscription period rollover -> add plan credits (don't reset).
  let didRollover = false;
  if (periodStartMs > storedPeriodStart) {
    creditsRemaining += planCap;
    didRollover = true;
  }

  // Persist normalization if anything changed.
  const needsUpdate =
    md.creditsRemaining === undefined ||
    md.videosUsedThisPeriod !== undefined ||
    didRollover ||
    md.plan !== plan ||
    storedPeriodStart !== periodStartMs;

  if (needsUpdate) {
    const nextMd = {
      ...md,
      plan,
      periodStart: String(periodStartMs),
      creditsRemaining: String(creditsRemaining),
    };
    // Clear the legacy key by setting it to empty string (Stripe interprets '' as delete).
    if (md.videosUsedThisPeriod !== undefined) nextMd.videosUsedThisPeriod = '';
    await stripe().customers.update(customerId, { metadata: nextMd });
  }

  // Trial: hard cap at 1 regardless of stored credits, via a separate flag.
  if (sub.status === 'trialing') {
    const trialUsed = md.trialUsed === '1';
    return {
      tier: plan,
      status: 'trialing',
      creditsRemaining: trialUsed ? 0 : 1,
      videoCap: 1,
      videosUsed: trialUsed ? 1 : 0,
      canSwap: !trialUsed,
      customerId,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    };
  }

  return {
    tier: plan,
    status: sub.status,
    creditsRemaining,
    videoCap: planCap, // displayed as plan baseline for context
    videosUsed: Math.max(0, planCap - creditsRemaining),
    canSwap: creditsRemaining > 0,
    customerId,
  };
}

export async function getEntitlement(req) {
  const cookies = readCookies(req);

  const customerId = cookies[COOKIES.customer];
  if (customerId) {
    try {
      const paid = await readPaidEntitlement(customerId);
      if (paid) return paid;
    } catch {
      // fall through
    }
  }

  return {
    tier: 'none',
    videosUsed: 0,
    videoCap: 0,
    creditsRemaining: 0,
    canSwap: false,
  };
}

/**
 * Decrement creditsRemaining on successful Banana generation.
 * For trialing subs, flip the one-shot trialUsed flag instead.
 */
export async function decrementCredits(req, res, entitlement) {
  if (!entitlement.customerId) return;

  if (entitlement.status === 'trialing') {
    await stripe().customers.update(entitlement.customerId, {
      metadata: { trialUsed: '1' },
    });
    return;
  }

  if (entitlement.tier === 'monthly' || entitlement.tier === 'yearly') {
    const customer = await stripe().customers.retrieve(entitlement.customerId);
    const md = customer && !customer.deleted ? customer.metadata || {} : {};
    const current = parseInt(md.creditsRemaining || '0', 10) || 0;
    const next = Math.max(0, current - 1);
    await stripe().customers.update(entitlement.customerId, {
      metadata: { ...md, creditsRemaining: String(next) },
    });
  }
}

/**
 * Add credits from a one-time top-up purchase. Safe to call on an
 * 'active' or 'trialing' subscriber; for trialing users, the credits
 * queue up for when they flip to active (trial still hard-caps at 1).
 */
export async function addCredits(customerId, credits) {
  if (!customerId || !credits || credits <= 0) return;
  const customer = await stripe().customers.retrieve(customerId);
  const md = customer && !customer.deleted ? customer.metadata || {} : {};
  const current = parseInt(md.creditsRemaining || '0', 10) || 0;
  const next = current + credits;
  await stripe().customers.update(customerId, {
    metadata: { ...md, creditsRemaining: String(next) },
  });
}
