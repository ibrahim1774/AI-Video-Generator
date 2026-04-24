import { stripe, planFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import { linkStripeCustomerToProfile } from '../../../lib/entitlement';
import { getUserFromRequest } from '../../../lib/supabaseServer';
import { sendCapiEvent } from '../../../lib/meta';

/*
 * Claim a Stripe Checkout Session that was created anonymously
 * (pay-first flow) and bind it to the just-signed-up Supabase user.
 *
 * Requires the caller to be signed in (the brand-new user from the
 * post-payment signup). Verifies the email on the Stripe session
 * matches the signed-in user's email — this is the security gate
 * that prevents one user from claiming another user's payment.
 *
 * Side effects on success:
 *   - Updates the Stripe customer's metadata with supabase_user_id
 *   - Seeds credits per plan (same as /api/checkout/confirm)
 *   - Links profiles.stripe_customer_id <-> the new user
 *   - Fires Purchase CAPI event with deduplication id
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Sign in first.' });

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
        : null);

    // Security: the signed-in user's email MUST match the email Stripe
    // collected. Otherwise anyone who gets a session_id could claim
    // someone else's subscription.
    const userEmail = (session.user.email || '').toLowerCase();
    if (!customerEmail || customerEmail.toLowerCase() !== userEmail) {
      return res.status(403).json({
        error: 'Email mismatch. Sign in with the same email you used at checkout.',
      });
    }

    const price = checkoutSession.line_items?.data?.[0]?.price;
    const plan = planFromPrice(price);
    if (!plan) {
      return res.status(400).json({ error: 'Session is not a subscription.' });
    }

    // Seed plan + credits on the Stripe customer's metadata. Same
    // shape as /api/checkout/confirm so the entitlement reader can
    // pick it up unchanged.
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
        pending_supabase_link: '',
      },
    });

    // Authoritative link in our profiles table.
    await linkStripeCustomerToProfile(session.supabase, session.user.id, customerId);

    const value = PLANS[plan].amountCents / 100;
    const eventId = `pur-${checkoutSession.id}`;
    await sendCapiEvent({
      eventName: 'Purchase',
      eventId,
      value,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: {
        kind: 'subscription',
        plan,
        supabase_user_id: session.user.id,
        claim: 1,
      },
    });

    return res.status(200).json({
      ok: true,
      tier: plan,
      videoCap: CAPS[plan],
      meta: { eventId, eventName: 'Purchase', value, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
