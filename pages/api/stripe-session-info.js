import { stripe, planFromPrice } from '../../lib/stripe';

/*
 * Public lookup of a small whitelist of fields from a Stripe Checkout
 * Session. Used by /sign-up after the anonymous "pay-first" flow so
 * the signup form can pre-fill (and lock) the email the user paid
 * with.
 *
 * The session_id is unguessable (~70-char Stripe ID), so leaking the
 * email of a session you possess the ID for is acceptable — it's
 * essentially a continuation token. No auth required.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id: sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'Valid session_id required.' });
  }

  try {
    const checkoutSession = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'customer'],
    });

    const email =
      checkoutSession.customer_details?.email ||
      (typeof checkoutSession.customer === 'object'
        ? checkoutSession.customer?.email
        : null) ||
      null;

    const price = checkoutSession.line_items?.data?.[0]?.price;
    const plan = planFromPrice(price);

    return res.status(200).json({
      email,
      plan,
      // Only consider the session "claimable" if it's paid AND we have
      // an email on it. The signup form gates on this.
      claimable: Boolean(email && checkoutSession.payment_status !== 'unpaid'),
      paymentStatus: checkoutSession.payment_status,
    });
  } catch (err) {
    return res.status(404).json({ error: 'Session not found.' });
  }
}
