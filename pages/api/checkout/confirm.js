import { stripe, PLAN_BY_PRICE, CAPS } from '../../../lib/stripe';
import { setCustomerCookie } from '../../../lib/entitlement';

/**
 * Called by the client right after Stripe Checkout returns to the
 * app with ?session_id=cs_xxx. Looks up the session, sets the
 * ff_customer cookie, and (defensively) initializes the customer's
 * usage metadata if the webhook hasn't fired yet.
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
      expand: ['line_items', 'subscription'],
    });
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customerId) {
      return res.status(400).json({ error: 'Session has no customer.' });
    }

    // Defensive metadata bootstrap (webhook will also do this).
    const priceId = session.line_items?.data?.[0]?.price?.id;
    const plan = PLAN_BY_PRICE[priceId];
    if (plan) {
      const customer = await stripe().customers.retrieve(customerId);
      const md = customer && !customer.deleted ? customer.metadata || {} : {};
      if (md.plan !== plan) {
        await stripe().customers.update(customerId, {
          metadata: {
            plan,
            periodStart: String(Date.now()),
            videosUsedThisPeriod: '0',
          },
        });
      }
    }

    setCustomerCookie(res, customerId);
    return res.status(200).json({
      ok: true,
      tier: plan || 'unknown',
      videoCap: plan ? CAPS[plan] : 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
