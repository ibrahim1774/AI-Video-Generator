import {
  stripe,
  getOrCreatePrice,
  getOrCreateTopupPrice,
  PLANS,
  TOPUPS,
} from '../../lib/stripe';
import { getUserFromRequest, getSupabaseAdmin } from '../../lib/supabaseServer';
import { sendCapiEvent } from '../../lib/meta';
import { nsEventId } from '../../lib/metaKeys';
import { linkStripeCustomerToProfile } from '../../lib/entitlement';

/*
 * Resolve (or create exactly once) the Stripe customer for a given
 * Supabase user. Three lookups before falling back to create:
 *
 *   1. profiles.stripe_customer_id (authoritative link). If the
 *      stored ID exists in Stripe and isn't deleted, reuse it.
 *   2. Stripe Customer Search by metadata.supabase_user_id. Catches
 *      cases where /confirm or the webhook stamped the metadata but
 *      the profile row never got written (e.g. RLS hiccup).
 *   3. Stripe customers.list by email. Picks the customer whose
 *      metadata.supabase_user_id matches (or an unowned one), so we
 *      adopt — not duplicate — any pre-existing email match.
 *
 * Only step 4 (create) is reached when none of the above produce a
 * customer. We always re-stamp the supabase_user_id metadata and
 * upsert profile.stripe_customer_id, so subsequent calls converge
 * on the same customer.
 *
 * Previously each top-up click could fall through to step 4 if the
 * profile upsert silently failed; the subscription path could
 * always produce a new customer because it passed only
 * customer_email to Stripe Checkout (which creates a new customer
 * per session in subscription mode).
 */
async function resolveStripeCustomerForUser({ admin, userId, email }) {
  let customerId = null;

  // 1) Profile lookup + Stripe existence check
  try {
    const { data } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    if (data?.stripe_customer_id) {
      try {
        const c = await stripe().customers.retrieve(data.stripe_customer_id);
        if (c && !c.deleted) customerId = c.id;
      } catch (retrieveErr) {
        console.warn(
          '[customer-resolve] linked customer not in Stripe, will re-resolve',
          retrieveErr.message
        );
      }
    }
  } catch (lookupErr) {
    console.warn('[customer-resolve] profile lookup failed', lookupErr.message);
  }

  // 2) Stripe Customer Search by metadata.supabase_user_id
  if (!customerId) {
    try {
      const search = await stripe().customers.search({
        query: `metadata['supabase_user_id']:'${userId}'`,
        limit: 1,
      });
      if (search.data.length > 0) customerId = search.data[0].id;
    } catch (searchErr) {
      console.warn('[customer-resolve] metadata search failed', searchErr.message);
    }
  }

  // 3) Email match — adopt the best-fit existing customer
  if (!customerId && email) {
    try {
      const list = await stripe().customers.list({ email, limit: 100 });
      if (list.data.length > 0) {
        const exactMatch = list.data.find(
          (c) => c.metadata?.supabase_user_id === userId
        );
        const unowned = list.data.find((c) => !c.metadata?.supabase_user_id);
        const chosen = exactMatch || unowned || list.data[0];
        customerId = chosen.id;
      }
    } catch (listErr) {
      console.warn('[customer-resolve] email list failed', listErr.message);
    }
  }

  // 4) Create a fresh customer (only when no existing match)
  if (!customerId) {
    console.log('[customer-resolve] creating new Stripe customer for', userId, email || '(no email)');
    const created = await stripe().customers.create({
      email: email || undefined,
      metadata: { supabase_user_id: userId },
    });
    customerId = created.id;
  }

  // Idempotently stamp supabase_user_id on the customer's metadata.
  try {
    const customerNow = await stripe().customers.retrieve(customerId);
    const md = customerNow && !customerNow.deleted ? customerNow.metadata || {} : {};
    if (md.supabase_user_id !== userId) {
      await stripe().customers.update(customerId, {
        metadata: { ...md, supabase_user_id: userId },
      });
    }
  } catch (mdErr) {
    console.warn('[customer-resolve] metadata sync failed', mdErr.message);
  }

  // Authoritative link in our profiles table. Failure throws here
  // intentionally — if we can't persist the link, future calls will
  // re-resolve via Stripe search/email and converge anyway.
  try {
    await linkStripeCustomerToProfile(admin, userId, customerId);
  } catch (linkErr) {
    console.warn(
      '[customer-resolve] profile link failed — search/email fallback will still find this customer next time',
      linkErr.message
    );
  }

  return customerId;
}

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

  const { plan, mode, pack, returnTo, surface } = req.body || {};

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

      // Resolve (or first-time create) a single Stripe customer for
      // this Supabase user. Reuses an existing customer when one
      // exists in any of: profile link, metadata search, email
      // match — so a customer who already subscribed via a different
      // path doesn't get a duplicate created here.
      const admin = getSupabaseAdmin();
      const customerId = await resolveStripeCustomerForUser({
        admin,
        userId: session.user.id,
        email,
      });

      const checkout = await stripe().checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: price.id, quantity: 1 }],
        customer: customerId,
        success_url: `${origin}/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}${returnQuery}`,
        cancel_url: `${origin}/dashboard?paid=0`,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        metadata: { supabase_user_id: session.user.id },
      });
      const value = TOPUPS[pack].amountCents / 100;
      const eventId = nsEventId(`ic-${checkout.id}`);
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

    if (plan !== 'monthly' && plan !== 'pro' && plan !== 'yearly') {
      return res.status(400).json({
        error: "Expected { plan: 'monthly'|'pro'|'yearly' } or { mode: 'topup', pack: 's'|'m'|'l' }.",
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
    // Surface picks the per-surface Product variant so the checkout
    // page header shows the right name ("Glow Up Yearly Plan",
    // "AI Interior Yearly Plan", etc). Same price, same entitlement.
    const ALLOWED_SURFACES = new Set(['default', 'glow-up', 'interior-design']);
    const safeSurface = ALLOWED_SURFACES.has(surface) ? surface : 'default';
    const price = await getOrCreatePrice(plan, safeSurface);

    // For authed users, resolve (or first-time create) a single
    // Stripe customer and pass `customer: customerId`. Stripe
    // Checkout in subscription mode creates a NEW customer every
    // time when you pass `customer_email` instead — that's how
    // duplicates were piling up. Anonymous flow still falls back
    // to `customer_email` since we have no Supabase user yet.
    let subCustomerId = null;
    if (!isAnon) {
      const admin = getSupabaseAdmin();
      subCustomerId = await resolveStripeCustomerForUser({
        admin,
        userId: session.user.id,
        email,
      });
    }

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      ...(subCustomerId
        ? { customer: subCustomerId }
        : email
          ? { customer_email: email }
          : {}),
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
    const eventId = nsEventId(`ic-${checkout.id}`);
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
