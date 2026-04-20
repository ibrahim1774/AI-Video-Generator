import { stripe, planFromPrice, topupFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import {
  addCredits,
  linkStripeCustomerToProfile,
} from '../../../lib/entitlement';
import { getUserFromRequest } from '../../../lib/supabaseServer';
import { sendCapiEvent } from '../../../lib/meta';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { session_id: sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }

  try {
    const checkoutSession = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'subscription', 'customer'],
    });

    const customerId =
      typeof checkoutSession.customer === 'string'
        ? checkoutSession.customer
        : checkoutSession.customer?.id;
    if (!customerId) {
      return res.status(400).json({ error: 'Session has no customer.' });
    }

    const customerEmail =
      checkoutSession.customer_details?.email ||
      (typeof checkoutSession.customer === 'object'
        ? checkoutSession.customer?.email
        : null) ||
      session.user.email;

    const price = checkoutSession.line_items?.data?.[0]?.price;
    const plan = planFromPrice(price);
    const topup = topupFromPrice(price);

    let eventKind = 'unknown';
    let value;
    let creditsAdded = 0;

    if (plan) {
      const sub = checkoutSession.subscription;
      const periodStartMs =
        ((sub && sub.current_period_start) || Math.floor(Date.now() / 1000)) * 1000;
      const customer = await stripe().customers.retrieve(customerId);
      const md = customer && !customer.deleted ? customer.metadata || {} : {};
      const existingCredits = parseInt(md.creditsRemaining || '0', 10) || 0;
      const seededCredits = Math.max(existingCredits, CAPS[plan]);
      await stripe().customers.update(customerId, {
        metadata: {
          ...md,
          plan,
          periodStart: String(periodStartMs),
          creditsRemaining: String(seededCredits),
          supabase_user_id: session.user.id,
          videosUsedThisPeriod: '',
          trialUsed: '',
        },
      });
      eventKind = 'subscription';
      value = PLANS[plan].amountCents / 100;
    } else if (topup) {
      await addCredits(customerId, topup.credits);
      eventKind = 'topup';
      value = topup.amountCents / 100;
      creditsAdded = topup.credits;
    }

    // Bind Stripe customer <-> Supabase profile (authoritative link).
    await linkStripeCustomerToProfile(session.supabase, session.user.id, customerId);

    const eventId = `pur-${checkoutSession.id}`;
    await sendCapiEvent({
      eventName: 'Purchase',
      eventId,
      value,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: {
        kind: eventKind,
        plan: plan || undefined,
        pack: topup?.key || undefined,
        supabase_user_id: session.user.id,
      },
    });

    return res.status(200).json({
      ok: true,
      kind: eventKind,
      tier: plan || 'unknown',
      videoCap: plan ? CAPS[plan] : 0,
      creditsAdded,
      meta: { eventId, eventName: 'Purchase', value, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
