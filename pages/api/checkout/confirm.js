import { stripe, planFromPrice, topupFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import { setCustomerCookie, addCredits } from '../../../lib/entitlement';
import { sendCapiEvent } from '../../../lib/meta';

/**
 * Handles return from Stripe Checkout for both:
 *   - subscriptions (mode='subscription'): set ff_customer cookie, init
 *     subscription metadata, fire Meta Purchase event.
 *   - one-time top-ups (mode='payment'): set ff_customer cookie, add
 *     the pack's credits to the customer, fire Meta Purchase event.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { session_id: sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }

  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'subscription', 'customer'],
    });
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customerId) {
      return res.status(400).json({ error: 'Session has no customer.' });
    }

    const customerEmail =
      session.customer_details?.email ||
      (typeof session.customer === 'object' ? session.customer?.email : null);

    const price = session.line_items?.data?.[0]?.price;
    const plan = planFromPrice(price);
    const topup = topupFromPrice(price);

    let eventKind = 'unknown';
    let value;
    let creditsAdded = 0;

    if (plan) {
      // Subscription checkout — initialize metadata for this subscriber.
      const sub = session.subscription;
      const periodStartMs = ((sub && sub.current_period_start) || Math.floor(Date.now() / 1000)) * 1000;
      const customer = await stripe().customers.retrieve(customerId);
      const md = customer && !customer.deleted ? customer.metadata || {} : {};
      // Seed creditsRemaining with the plan's cap on fresh signup, but
      // don't overwrite an existing positive balance (e.g. reactivation).
      const existingCredits = parseInt(md.creditsRemaining || '0', 10) || 0;
      const seededCredits = Math.max(existingCredits, CAPS[plan]);
      await stripe().customers.update(customerId, {
        metadata: {
          ...md,
          plan,
          periodStart: String(periodStartMs),
          creditsRemaining: String(seededCredits),
          // Clear any lingering legacy flags.
          videosUsedThisPeriod: '',
          trialUsed: '',
        },
      });
      eventKind = 'subscription';
      value = PLANS[plan].amountCents / 100;
    } else if (topup) {
      // One-time top-up — add credits to balance.
      await addCredits(customerId, topup.credits);
      eventKind = 'topup';
      value = topup.amountCents / 100;
      creditsAdded = topup.credits;
    }

    setCustomerCookie(res, customerId);

    // Meta CAPI Purchase event (deduped with client Pixel via eventId).
    const eventId = `pur-${session.id}`;
    await sendCapiEvent({
      eventName: 'Purchase',
      eventId,
      value,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: { kind: eventKind, plan: plan || undefined, pack: topup?.key || undefined },
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
