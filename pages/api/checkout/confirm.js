import { v4 as uuidv4 } from 'uuid';

import { stripe, planFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import { setCustomerCookie } from '../../../lib/entitlement';
import { sendCapiEvent } from '../../../lib/meta';

/**
 * Called by the client right after Stripe Checkout returns to the
 * app with ?session_id=cs_xxx. Looks up the session, sets the
 * ff_customer cookie, initializes the customer's metadata, and
 * fires a Meta CAPI 'Subscribe' event (deduped against the client
 * Pixel via shared eventId).
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
    if (plan) {
      const sub = session.subscription;
      const periodStartMs = ((sub && sub.current_period_start) || Math.floor(Date.now() / 1000)) * 1000;
      await stripe().customers.update(customerId, {
        metadata: {
          plan,
          periodStart: String(periodStartMs),
          videosUsedThisPeriod: '0',
        },
      });
    }

    setCustomerCookie(res, customerId);

    // Meta CAPI: Purchase event (deduped with client Pixel via eventId).
    // Fires on checkout completion \u2014 treats trial signup as the purchase
    // moment for ad-attribution purposes (no Stripe webhook needed).
    const eventId = `pur-${session.id}`;
    const value = plan ? PLANS[plan].amountCents / 100 : undefined;
    await sendCapiEvent({
      eventName: 'Purchase',
      eventId,
      value,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: { plan: plan || 'unknown' },
    });

    return res.status(200).json({
      ok: true,
      tier: plan || 'unknown',
      videoCap: plan ? CAPS[plan] : 0,
      meta: { eventId, eventName: 'Purchase', value, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
