import { parse, serialize } from 'cookie';

import { stripe, CAPS, TRIAL_MS, planFromPrice } from './stripe';

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

export const COOKIES = {
  trialStarted: 'ff_trial_started',
  trialUsed: 'ff_trial_used',
  customer: 'ff_customer',
  dev: 'ff_dev',
};

function readCookies(req) {
  const header = req.headers?.cookie || '';
  return parse(header || '');
}

export function setTrialCookies(res, { startedAt, used }) {
  res.setHeader('Set-Cookie', [
    serialize(COOKIES.trialStarted, String(startedAt), {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 7,
    }),
    serialize(COOKIES.trialUsed, String(used), {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 7,
    }),
  ]);
}

export function setDevCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIES.dev, '1', {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 30,
    })
  );
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

function bumpTrialUsedCookie(res, nextUsed, startedAt) {
  res.setHeader('Set-Cookie', [
    serialize(COOKIES.trialUsed, String(nextUsed), {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 7,
    }),
    serialize(COOKIES.trialStarted, String(startedAt), {
      ...COOKIE_BASE,
      maxAge: 60 * 60 * 24 * 7,
    }),
  ]);
}

/**
 * Look up the user's current Stripe subscription state by listing
 * active subscriptions on the cookie's customerId. Falls back to
 * trial state if no active subscription exists.
 *
 * Side-effect: if Stripe reports a new billing period
 * (current_period_start > metadata.periodStart), resets the usage
 * counter so the user gets their fresh allotment.
 */
async function readPaidEntitlement(customerId) {
  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
    expand: ['data.items.data.price'],
  });
  const sub = subs.data[0];
  if (!sub) return null;
  const price = sub.items?.data?.[0]?.price;
  const plan = planFromPrice(price);
  if (!plan) return null;

  const customer = await stripe().customers.retrieve(customerId);
  const md = customer && !customer.deleted ? customer.metadata || {} : {};

  const periodStartMs = (sub.current_period_start || 0) * 1000;
  const storedPeriodStart = parseInt(md.periodStart || '0', 10);
  let used = parseInt(md.videosUsedThisPeriod || '0', 10) || 0;

  if (periodStartMs > storedPeriodStart) {
    used = 0;
    await stripe().customers.update(customerId, {
      metadata: {
        plan,
        periodStart: String(periodStartMs),
        videosUsedThisPeriod: '0',
      },
    });
  } else if (md.plan !== plan) {
    await stripe().customers.update(customerId, {
      metadata: { ...md, plan },
    });
  }

  const cap = CAPS[plan];
  return {
    tier: plan,
    videosUsed: used,
    videoCap: cap,
    canSwap: used < cap,
    customerId,
  };
}

/**
 * Returns the entitlement summary the UI uses to decide whether to
 * show the paywall. Pure read — does not mutate cookies (but may
 * write to Stripe metadata to handle period rollover).
 */
export async function getEntitlement(req) {
  const cookies = readCookies(req);

  // Dev/test override: unlimited runs, never increments usage.
  if (cookies[COOKIES.dev] === '1') {
    return {
      tier: 'dev',
      videosUsed: 0,
      videoCap: Infinity,
      canSwap: true,
    };
  }

  const customerId = cookies[COOKIES.customer];
  if (customerId) {
    try {
      const paid = await readPaidEntitlement(customerId);
      if (paid) return paid;
    } catch {
      // fall through to trial
    }
  }

  const startedAt = parseInt(cookies[COOKIES.trialStarted] || '0', 10);
  const trialUsed = parseInt(cookies[COOKIES.trialUsed] || '0', 10);
  if (startedAt > 0) {
    const trialEndsAt = startedAt + TRIAL_MS;
    const expired = Date.now() > trialEndsAt;
    return {
      tier: 'trial',
      videosUsed: trialUsed,
      videoCap: CAPS.trial,
      trialEndsAt: new Date(trialEndsAt).toISOString(),
      canSwap: !expired && trialUsed < CAPS.trial,
      expired,
    };
  }

  return {
    tier: 'none',
    videosUsed: 0,
    videoCap: 0,
    canSwap: false,
  };
}

/**
 * Increment the user's usage counter after a successful swap.
 */
export async function incrementUsage(req, res, entitlement) {
  if (entitlement.tier === 'dev') return; // unlimited testing — no-op
  if (entitlement.tier === 'monthly' || entitlement.tier === 'yearly') {
    const customerId = entitlement.customerId;
    if (!customerId) return;
    const next = (entitlement.videosUsed || 0) + 1;
    const customer = await stripe().customers.retrieve(customerId);
    const md = customer && !customer.deleted ? customer.metadata || {} : {};
    await stripe().customers.update(customerId, {
      metadata: { ...md, videosUsedThisPeriod: String(next) },
    });
    return;
  }
  if (entitlement.tier === 'trial') {
    const cookies = readCookies(req);
    const startedAt = parseInt(cookies[COOKIES.trialStarted] || '0', 10);
    const next = (entitlement.videosUsed || 0) + 1;
    bumpTrialUsedCookie(res, next, startedAt);
  }
}
