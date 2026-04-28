import { stripe, planFromPrice, PLANS } from '../../lib/stripe';
import { sendCapiEvent } from '../../lib/meta';

/*
 * Stripe webhook handler.
 *
 * Subscribed to `invoice.payment_succeeded`. Fires Meta CAPI Purchase
 * for any subscription invoice that actually moved money, except the
 * very first invoice on a non-trial signup — that case is already
 * reported by /api/checkout/confirm at checkout completion. This
 * catches:
 *   - Yearly trial conversions (24h after signup, when Stripe takes
 *     the first $49 charge — billing_reason='subscription_cycle')
 *   - Every renewal cycle thereafter
 *   - Monthly renewals (month 2+)
 *
 * Also writes `lastReportedPeriodStart` on the customer metadata so
 * the lazy fallback in lib/entitlement.js doesn't re-fire the same
 * Purchase the next time the user opens the dashboard.
 *
 * Setup:
 *   1. Stripe Dashboard → Webhooks → endpoint
 *      https://<host>/api/stripe-webhook subscribed to
 *      invoice.payment_succeeded
 *   2. Add STRIPE_WEBHOOK_SECRET (whsec_…) to Vercel env vars.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method not allowed');
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];
  if (!secret) {
    console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).end('Webhook secret not configured');
  }
  if (!sig) {
    return res.status(400).end('Missing stripe-signature header');
  }

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed', err.message);
    return res.status(400).end(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      await handleInvoicePaymentSucceeded(event.data.object, req);
    }
  } catch (err) {
    // Log and swallow — return 200 so Stripe doesn't retry on app-side
    // bugs. The lazy fallback in lib/entitlement.js will still fire the
    // Purchase next time the user pings any of our APIs.
    console.error('[stripe-webhook] handler threw', err.message);
  }

  return res.status(200).json({ received: true });
}

async function handleInvoicePaymentSucceeded(invoice, req) {
  if (!invoice.subscription) return;
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return;
  if (invoice.billing_reason === 'subscription_create') return;

  const subId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
  const sub = await stripe().subscriptions.retrieve(subId, {
    expand: ['items.data.price'],
  });
  const price = sub.items?.data?.[0]?.price;
  const plan = planFromPrice(price);

  const value = plan ? PLANS[plan].amountCents / 100 : invoice.amount_paid / 100;

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  let email = invoice.customer_email;
  let supabaseUserId;
  let customerMd = {};
  if (customerId) {
    try {
      const customer = await stripe().customers.retrieve(customerId);
      if (customer && !customer.deleted) {
        email = email || customer.email;
        customerMd = customer.metadata || {};
        supabaseUserId = customerMd.supabase_user_id;
      }
    } catch (err) {
      console.warn('[stripe-webhook] customer retrieve failed', err.message);
    }
  }

  // Mark this period as reported so the lazy CAPI branch in
  // lib/entitlement.js skips it. Use sub.current_period_start (= when
  // the active billing period began) — same value the entitlement
  // reader compares against.
  const periodStartMs = (sub.current_period_start || 0) * 1000;
  if (customerId && periodStartMs > 0) {
    try {
      await stripe().customers.update(customerId, {
        metadata: {
          ...customerMd,
          lastReportedPeriodStart: String(periodStartMs),
        },
      });
    } catch (err) {
      console.warn('[stripe-webhook] customer metadata update failed', err.message);
    }
  }

  const eventId = `pur-inv-${invoice.id}`;
  await sendCapiEvent({
    eventName: 'Purchase',
    eventId,
    value,
    currency: (invoice.currency || 'usd').toUpperCase(),
    email,
    req,
    customData: {
      kind: 'subscription',
      plan: plan || undefined,
      billing_reason: invoice.billing_reason,
      supabase_user_id: supabaseUserId,
      invoice_id: invoice.id,
    },
  });
}
