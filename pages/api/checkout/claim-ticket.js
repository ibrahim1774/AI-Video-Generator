import { stripe, planFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import { linkStripeCustomerToProfile } from '../../../lib/entitlement';
import { getUserFromRequest } from '../../../lib/supabaseServer';
import { sendCapiEvent } from '../../../lib/meta';
import { KEY, nsEventId } from '../../../lib/metaKeys';

/*
 * UGC-2 ticket-claim endpoint (email-independent, leak-protected).
 *
 * Sibling of /api/checkout/claim, used ONLY by the /ugc-2 pay-first
 * flow. Differences from /api/checkout/claim:
 *
 *   - The Stripe Checkout session_id is read from an httpOnly cookie
 *     (`ugc2_claim_sid`) set server-side by /ugc-2/claim, NOT from the
 *     request/query. The ticket never appears in a client-rendered URL,
 *     so it can't leak to the Meta/TikTok pixels or browser referrers.
 *   - There is NO email-match gate. The user may sign up with ANY email
 *     or Google account; the binding is authorized solely by possession
 *     of the (unguessable, single-use, short-lived, httpOnly) ticket.
 *
 * Everything else — payment-status guard, single-use processedSessions
 * idempotency, credit seeding, profile link, Purchase CAPI — mirrors
 * /api/checkout/claim verbatim so the entitlement reader is unchanged.
 *
 * This endpoint is fully isolated: /api/checkout/claim and every other
 * paid surface keep their email-match behavior untouched.
 */

const CLAIM_COOKIE = 'ugc2_claim_sid';

function clearClaimCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${CLAIM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Sign in first.' });

  // Ticket comes from the httpOnly cookie, never the request body/query.
  const sessionId = req.cookies?.[CLAIM_COOKIE];
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({
      error: 'No payment in progress. Please start checkout again.',
    });
  }

  try {
    const checkoutSession = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'subscription', 'customer'],
    });

    // Same payment-status hard guard as /api/checkout/confirm.
    const okPaymentStatuses = new Set(['paid', 'no_payment_required']);
    if (!okPaymentStatuses.has(checkoutSession.payment_status)) {
      return res.status(400).json({
        error: `Payment not completed (status: ${checkoutSession.payment_status}).`,
      });
    }

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

    // NOTE: intentionally NO email-match gate here. Authorization is the
    // httpOnly, single-use, short-lived ticket. See file header.

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
    const sessionTag = checkoutSession.id.replace(/^cs_(test_|live_)/, '').slice(-32);
    const processed = (md[KEY.processedSessions] || '').split(',').filter(Boolean);
    if (processed.includes(sessionTag)) {
      // Already claimed (refresh / double tab / prior claim) — bind the
      // profile (cheap, idempotent) and return success without
      // re-seeding credits. Single-use: the ticket is spent.
      await linkStripeCustomerToProfile(session.supabase, session.user.id, customerId);
      clearClaimCookie(res);
      return res.status(200).json({
        ok: true,
        alreadyProcessed: true,
        tier: plan,
        videoCap: CAPS[plan],
      });
    }
    const existingCredits = parseInt(md[KEY.credits] || '0', 10) || 0;
    // See /api/checkout/confirm.js for the rationale: trialing subs
    // only get the 2-credit trial pool until current_period_start
    // jumps on conversion to active.
    const isTrialing = sub && sub.status === 'trialing';
    const seededCredits = isTrialing
      ? existingCredits
      : Math.max(existingCredits, CAPS[plan]);
    const nextProcessed = [sessionTag, ...processed].slice(0, 10).join(',');
    await stripe().customers.update(customerId, {
      metadata: {
        ...md,
        [KEY.plan]: plan,
        [KEY.periodStart]: String(periodStartMs),
        [KEY.credits]: String(seededCredits),
        supabase_user_id: session.user.id,
        [KEY.videosUsedThisPeriod]: '',
        [KEY.trialUsed]: '',
        [KEY.processedSessions]: nextProcessed,
        pending_supabase_link: '',
      },
    });

    // Authoritative link in our profiles table.
    await linkStripeCustomerToProfile(session.supabase, session.user.id, customerId);

    // Ticket is spent — clear the cookie so it can't be replayed.
    clearClaimCookie(res);

    const value = PLANS[plan].amountCents / 100;
    // Match /api/checkout/confirm.js: a trialing yearly sub fires
    // StartTrial (no charge yet); the real Purchase fires from the
    // Stripe webhook when the post-trial invoice is paid.
    const isTrialingSub = sub?.status === 'trialing';
    const eventName = isTrialingSub ? 'StartTrial' : 'Purchase';
    const eventId = nsEventId(`${isTrialingSub ? 'st' : 'pur'}-${checkoutSession.id}`);
    const reportedValue = isTrialingSub ? 0 : value;
    await sendCapiEvent({
      eventName,
      eventId,
      value: reportedValue,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: {
        kind: 'subscription',
        plan,
        supabase_user_id: session.user.id,
        claim: 1,
        flow: 'ugc2-ticket',
      },
    });

    return res.status(200).json({
      ok: true,
      tier: plan,
      videoCap: CAPS[plan],
      meta: { eventId, eventName, value: reportedValue, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
