import { parse, serialize } from 'cookie';

import { stripe, CAPS, TRIAL_MS } from './stripe';

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
 * Returns the entitlement summary the UI uses to decide whether to
 * show the paywall. Pure read — does not mutate any state.
 */
export async function getEntitlement(req) {
  const cookies = readCookies(req);

  // Paid customer takes precedence.
  const customerId = cookies[COOKIES.customer];
  if (customerId) {
    try {
      const customer = await stripe().customers.retrieve(customerId);
      if (customer && !customer.deleted) {
        const md = customer.metadata || {};
        const plan = md.plan;
        if (plan === 'monthly' || plan === 'yearly') {
          const used = parseInt(md.videosUsedThisPeriod || '0', 10) || 0;
          const cap = CAPS[plan];
          return {
            tier: plan,
            videosUsed: used,
            videoCap: cap,
            canSwap: used < cap,
            customerId,
          };
        }
      }
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
 * Increment the user's usage counter after a successful swap kickoff.
 */
export async function incrementUsage(req, res, entitlement) {
  if (entitlement.tier === 'monthly' || entitlement.tier === 'yearly') {
    const customerId = entitlement.customerId;
    if (!customerId) return;
    const next = (entitlement.videosUsed || 0) + 1;
    await stripe().customers.update(customerId, {
      metadata: { videosUsedThisPeriod: String(next) },
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
