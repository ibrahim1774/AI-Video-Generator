import { stripe, planFromPrice, PLANS } from '../../lib/stripe';
import { sendCapiEvent } from '../../lib/meta';

/*
 * Stripe webhook handler.
 *
 * Today it only fires Meta CAPI Purchase events for paid subscription
 * invoices that aren't the first invoice — i.e. the trial-conversion
 * charge and every renewal cycle. The first-invoice case for
 * non-trialing monthly signups is already covered by the Purchase
 * fired from /api/checkout/confirm at checkout completion, so we skip
 * `subscription_create` here to avoid double-counting.
 *
 * Setup: in the Stripe Dashboard create a webhook pointed at
 *   https://<host>/api/stripe-webhook
 * subscribed to `invoice.payment_succeeded`, then add the signing
 * secret as STRIPE_WEBHOOK_SECRET in Vercel env vars.
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
    console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
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
    console.error('[stripe-webhook] handler threw', err.message);
    // Return 200 anyway so Stripe doesn't retry on a non-recoverable
    // app-side error. Errors are logged for manual investigation.
  }

  return res.status(200).json({ received: true });
}

async function handleInvoicePaymentSucceeded(invoice, req) {
  // Only care about subscription invoices that actually moved money.
  if (!invoice.subscription) return;
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return;
  // First invoice on a non-trial monthly signup is already reported by
  // /api/checkout/confirm — skip to avoid duplicate Purchase events.
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

  // Prefer the plan's canonical price for value reporting (cents → $);
  // fall back to invoice.amount_paid if the plan can't be resolved.
  const value = plan ? PLANS[plan].amountCents / 100 : invoice.amount_paid / 100;

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  let email = invoice.customer_email;
  let supabaseUserId;
  if (customerId) {
    try {
      const customer = await stripe().customers.retrieve(customerId);
      if (customer && !customer.deleted) {
        email = email || customer.email;
        supabaseUserId = customer.metadata?.supabase_user_id;
      }
    } catch (err) {
      console.warn('[stripe-webhook] customer retrieve failed', err.message);
    }
  }

  // Use the invoice id so trial-conversion + each yearly renewal
  // produce a unique Purchase event. Browser pixel can't dedup these
  // because the user isn't on a page when Stripe charges them — this
  // is server-only.
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
