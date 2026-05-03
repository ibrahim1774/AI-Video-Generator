import {
  stripe,
  getOrCreatePrice,
  getOrCreateTopupPrice,
  PLANS,
  TOPUPS,
} from '../../lib/stripe';
import { getUserFromRequest } from '../../lib/supabaseServer';
import { sendCapiEvent } from '../../lib/meta';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Subscription path supports anonymous users (pay first, sign up
  // after). Top-up requires auth because credits attach to an
  // existing account.
  const session = await getUserFromRequest(req, res);
  const isAnon = !session;
  const email = session?.user?.email;

  const { plan, mode, pack, returnTo } = req.body || {};

  if (mode === 'topup' && isAnon) {
    return res.status(401).json({ error: 'Sign in required to buy a top-up.' });
  }

  const origin =
    process.env.APP_URL ||
    (req.headers.origin && req.headers.origin.replace(/\/$/, '')) ||
    `https://${req.headers.host}`;

  // Optional: where to send the user after dashboard finishes
  // confirming the Stripe session. Validated to be a same-origin
  // path so the redirect can never escape to an external URL.
  const safeReturnTo =
    typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '';
  const returnQuery = safeReturnTo ? `&returnTo=${encodeURIComponent(safeReturnTo)}` : '';

  try {
    if (mode === 'topup') {
      if (!TOPUPS[pack]) {
        return res.status(400).json({ error: 'Invalid top-up pack.' });
      }
      const price = await getOrCreateTopupPrice(pack);
      const checkout = await stripe().checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: price.id, quantity: 1 }],
        customer_email: email,
        success_url: `${origin}/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}${returnQuery}`,
        cancel_url: `${origin}/dashboard?paid=0`,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        metadata: { supabase_user_id: session.user.id },
      });
      const value = TOPUPS[pack].amountCents / 100;
      const eventId = `ic-${checkout.id}`;
      sendCapiEvent({
        eventName: 'InitiateCheckout',
        eventId,
        value,
        currency: 'USD',
        email,
        req,
        customData: {
          kind: 'topup',
          pack,
          supabase_user_id: session.user.id,
        },
      }).catch(() => {});
      return res.status(200).json({
        url: checkout.url,
        meta: { eventName: 'InitiateCheckout', eventId, value, currency: 'USD' },
      });
    }

    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({
        error: "Expected { plan: 'monthly'|'yearly' } or { mode: 'topup', pack: 's'|'m'|'l' }.",
      });
    }

    // Anonymous subscription: route success_url through the claim-
    // and-create-account flow on /sign-up. The user signs up with
    // the same email Stripe collected; backend then links the
    // Stripe customer to the new Supabase user.
    const successPath = isAnon
      ? `/sign-up?session_id={CHECKOUT_SESSION_ID}${returnQuery}`
      : `/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}${returnQuery}`;

    const subMetadata = isAnon
      ? { pending_supabase_link: 'true' }
      : { supabase_user_id: session.user.id };

    // Subscription flow: charge the plan price immediately. No trial,
    // no deposit — just a clean recurring sub. Monthly $5/mo, yearly
    // $29/yr. Stripe Checkout displays the renewal terms natively.
    const price = await getOrCreatePrice(plan);

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      ...(email ? { customer_email: email } : {}),
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}${isAnon ? '/' : '/dashboard?paid=0'}`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        metadata: subMetadata,
      },
      metadata: subMetadata,
    });

    // Pixel value: actual cents charged today.
    const value = PLANS[plan].amountCents / 100;
    const eventId = `ic-${checkout.id}`;
    sendCapiEvent({
      eventName: 'InitiateCheckout',
      eventId,
      value,
      currency: 'USD',
      email,
      req,
      customData: {
        kind: 'subscription',
        plan,
        ...(session?.user?.id ? { supabase_user_id: session.user.id } : { anonymous: 1 }),
      },
    }).catch(() => {});
    return res.status(200).json({
      url: checkout.url,
      meta: { eventName: 'InitiateCheckout', eventId, value, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
