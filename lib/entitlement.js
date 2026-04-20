import { stripe, CAPS, planFromPrice } from './stripe';

/*
 * Supabase-backed entitlement. Identity = Supabase user.id. We look
 * up their `stripe_customer_id` in the profiles table, then read the
 * Stripe subscription + customer metadata as before.
 *
 * All previous cookie-based logic is gone.
 */

async function getStripeCustomerIdForUser(supabase, userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[entitlement] profile lookup error', error.message);
    return null;
  }
  return data?.stripe_customer_id || null;
}

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
    const used = parseInt(md.videosUsedThisPeriod, 10) || 0;
    creditsRemaining = Math.max(0, planCap - used);
  } else {
    creditsRemaining = planCap;
  }

  let didRollover = false;
  if (periodStartMs > storedPeriodStart) {
    creditsRemaining += planCap;
    didRollover = true;
  }

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
    if (md.videosUsedThisPeriod !== undefined) nextMd.videosUsedThisPeriod = '';
    await stripe().customers.update(customerId, { metadata: nextMd });
  }

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
    videoCap: planCap,
    videosUsed: Math.max(0, planCap - creditsRemaining),
    canSwap: creditsRemaining > 0,
    customerId,
  };
}

/**
 * Main entitlement lookup. Pass the Supabase server client and user id.
 */
export async function getEntitlement({ supabase, userId }) {
  if (!userId) {
    return { tier: 'none', videosUsed: 0, videoCap: 0, creditsRemaining: 0, canSwap: false };
  }
  const customerId = await getStripeCustomerIdForUser(supabase, userId);
  if (!customerId) {
    return { tier: 'none', videosUsed: 0, videoCap: 0, creditsRemaining: 0, canSwap: false };
  }
  try {
    const paid = await readPaidEntitlement(customerId);
    if (paid) return paid;
  } catch (err) {
    console.warn('[entitlement] Stripe lookup failed', err.message);
  }
  return { tier: 'none', videosUsed: 0, videoCap: 0, creditsRemaining: 0, canSwap: false };
}

/**
 * Consume credits on successful generation. For trialing subs, flip
 * the one-shot trialUsed flag instead of decrementing.
 */
export async function decrementCredits(entitlement, amount = 1) {
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
    const next = Math.max(0, current - Math.max(1, amount));
    await stripe().customers.update(entitlement.customerId, {
      metadata: { ...md, creditsRemaining: String(next) },
    });
  }
}

/**
 * Strict reservation: re-reads the current creditsRemaining from
 * Stripe, ensures it covers the requested amount, then writes the
 * decremented value back. Throws { code: 'INSUFFICIENT', remaining }
 * if the user doesn't have enough credits at the moment of the call.
 *
 * Trial users keep their boolean trialUsed flag (no race possible).
 */
export async function reserveCredits(entitlement, amount = 1) {
  if (!entitlement.customerId) {
    const err = new Error('No Stripe customer linked.');
    err.code = 'NO_CUSTOMER';
    throw err;
  }

  if (entitlement.status === 'trialing') {
    const customer = await stripe().customers.retrieve(entitlement.customerId);
    const md = customer && !customer.deleted ? customer.metadata || {} : {};
    if (md.trialUsed === '1') {
      const err = new Error('Trial already used.');
      err.code = 'INSUFFICIENT';
      err.remaining = 0;
      throw err;
    }
    await stripe().customers.update(entitlement.customerId, {
      metadata: { ...md, trialUsed: '1' },
    });
    return;
  }

  if (entitlement.tier === 'monthly' || entitlement.tier === 'yearly') {
    const customer = await stripe().customers.retrieve(entitlement.customerId);
    const md = customer && !customer.deleted ? customer.metadata || {} : {};
    const current = parseInt(md.creditsRemaining || '0', 10) || 0;
    if (current < amount) {
      const err = new Error('Insufficient credits.');
      err.code = 'INSUFFICIENT';
      err.remaining = current;
      throw err;
    }
    const next = current - amount;
    await stripe().customers.update(entitlement.customerId, {
      metadata: { ...md, creditsRemaining: String(next) },
    });
    return;
  }

  const err = new Error('No active plan.');
  err.code = 'NO_PLAN';
  throw err;
}

/**
 * Refund a reservation. Use only when reservation succeeded but the
 * downstream work failed.
 */
export async function refundCredits(entitlement, amount = 1) {
  if (!entitlement.customerId) return;

  if (entitlement.status === 'trialing') {
    // Best-effort: clear the trialUsed flag the reservation set.
    await stripe().customers.update(entitlement.customerId, {
      metadata: { trialUsed: '' },
    });
    return;
  }

  if (entitlement.tier === 'monthly' || entitlement.tier === 'yearly') {
    const customer = await stripe().customers.retrieve(entitlement.customerId);
    const md = customer && !customer.deleted ? customer.metadata || {} : {};
    const current = parseInt(md.creditsRemaining || '0', 10) || 0;
    const next = current + Math.max(1, amount);
    await stripe().customers.update(entitlement.customerId, {
      metadata: { ...md, creditsRemaining: String(next) },
    });
  }
}

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

/**
 * Link a Stripe customer to a Supabase user's profile row.
 * Called from /api/checkout/confirm after a successful subscription purchase.
 */
export async function linkStripeCustomerToProfile(supabase, userId, stripeCustomerId) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, stripe_customer_id: stripeCustomerId }, { onConflict: 'id' });
  if (error) {
    console.error('[entitlement] failed to link profile', error.message);
    throw new Error(`Could not link Stripe customer: ${error.message}`);
  }
}
