import { stripe, planFromPrice, CAPS } from '../../../lib/stripe';
import { setCustomerCookie } from '../../../lib/entitlement';

/**
 * Called by the client right after Stripe Checkout returns to the
 * app with ?session_id=cs_xxx. Looks up the session, sets the
 * ff_customer cookie, and initializes the customer's metadata so
 * the very first /api/entitlement read after this call already
 * sees the right plan + period start.
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
      expand: ['line_items.data.price', 'subscription'],
    });
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!customerId) {
      return res.status(400).json({ error: 'Session has no customer.' });
    }

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
    return res.status(200).json({
      ok: true,
      tier: plan || 'unknown',
      videoCap: plan ? CAPS[plan] : 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
