import {
  stripe,
  getOrCreatePrice,
  getOrCreateTopupPrice,
  getOrCreateTrialDepositPrice,
  TRIAL_DEPOSIT,
  PLANS,
  TOPUPS,
} from '../../lib/stripe';
import { getUserFromRequest, getSupabaseAdmin } from '../../lib/supabaseServer';
import { sendCapiEvent } from '../../lib/meta';

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function isTrialBlockedForIp(userId, req) {
  const ip = clientIp(req);
  if (!ip) return false;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('signup_ips')
      .select('user_id')
      .eq('ip', ip);
    if (error) {
      console.warn('[checkout] ip lookup failed', error.message);
      return false;
    }
    return Array.isArray(data) && data.some((row) => row.user_id !== userId);
  } catch (err) {
    console.warn('[checkout] admin client unavailable', err.message);
    return false;
  }
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

    // Anonymous subscription: skip the IP-based trial block (we have
    // no user_id to scope by) and route success_url through the
    // claim-and-create-account flow on /sign-up. The user signs up
    // with the same email Stripe collected; backend then links the
    // Stripe customer to the new Supabase user.
    const trialBlocked = isAnon
      ? false
      : await isTrialBlockedForIp(session.user.id, req);

    const successPath = isAnon
      ? `/sign-up?session_id={CHECKOUT_SESSION_ID}${returnQuery}`
      : `/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}${returnQuery}`;

    const subMetadata = isAnon
      ? { pending_supabase_link: 'true' }
      : { supabase_user_id: session.user.id };

    // Yearly: paid 1-day trial via Stripe-native pattern. Charge $1
    // today as a one-time line item AND start the $49/yr recurring
    // subscription with trial_period_days: 1. Stripe Checkout
    // renders the full deal — "$1 today, then $49/year after 1-day
    // trial" — natively, satisfying disclosure rules. After 24h,
    // Stripe auto-bills the $49 unless the customer cancelled.
    //
    // Monthly: charges $5 immediately, no trial.
    const yearlyTrialFlow = plan === 'yearly';
    const recurringPrice = await getOrCreatePrice(plan);
    const trialDepositPrice = yearlyTrialFlow ? await getOrCreateTrialDepositPrice() : null;

    const lineItems = yearlyTrialFlow
      ? [
          { price: trialDepositPrice.id, quantity: 1 }, // $1 one-time deposit
          { price: recurringPrice.id, quantity: 1 },    // $49/yr recurring
        ]
      : [{ price: recurringPrice.id, quantity: 1 }];

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      ...(email ? { customer_email: email } : {}),
      success_url: `${origin}${successPath}`,
      cancel_url: `${origin}${isAnon ? '/' : '/dashboard?paid=0'}`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        ...(yearlyTrialFlow && !trialBlocked ? { trial_period_days: 1 } : {}),
        metadata: subMetadata,
      },
      metadata: subMetadata,
    });

    // Pixel value: actual cents the customer pays today. Yearly = $1
    // deposit; monthly = $5 first invoice. The $49 yearly renewal
    // fires its own Purchase via the webhook (subscription_cycle).
    const value = yearlyTrialFlow
      ? TRIAL_DEPOSIT.amountCents / 100
      : PLANS[plan].amountCents / 100;
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
        trialBlocked: trialBlocked ? 1 : 0,
        paidTrial: yearlyTrialFlow ? 1 : 0,
        ...(session?.user?.id ? { supabase_user_id: session.user.id } : { anonymous: 1 }),
      },
    }).catch(() => {});
    return res.status(200).json({
      url: checkout.url,
      trialBlocked,
      meta: { eventName: 'InitiateCheckout', eventId, value, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
