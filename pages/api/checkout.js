import { stripe, getOrCreatePrice, getOrCreateTopupPrice, TOPUPS } from '../../lib/stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan, mode, pack } = req.body || {};

  const origin =
    process.env.APP_URL ||
    (req.headers.origin && req.headers.origin.replace(/\/$/, '')) ||
    `https://${req.headers.host}`;

  try {
    // Top-up: one-time payment for a credit pack.
    if (mode === 'topup') {
      if (!TOPUPS[pack]) {
        return res.status(400).json({ error: 'Invalid top-up pack.' });
      }
      const price = await getOrCreateTopupPrice(pack);
      const session = await stripe().checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?paid=0`,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
      });
      return res.status(200).json({ url: session.url });
    }

    // Subscription: monthly / yearly.
    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({
        error: "Expected { plan: 'monthly'|'yearly' } or { mode: 'topup', pack: 's'|'m'|'l' }.",
      });
    }
    const price = await getOrCreatePrice(plan);
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?paid=0`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: { trial_period_days: 1 },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
