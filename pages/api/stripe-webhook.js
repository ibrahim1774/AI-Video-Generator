import { stripe } from '../../lib/stripe';
import { sendCapiEvent } from '../../lib/meta';

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Stripe webhook endpoint, scoped to one purpose: fire a Meta CAPI
 * 'Purchase' event when the trial converts into an actual paid
 * charge (invoice.payment_succeeded with amount_paid > 0).
 *
 * Add this endpoint in Stripe Dashboard \u2192 Developers \u2192 Webhooks
 * with the event `invoice.payment_succeeded` and copy the signing
 * secret into STRIPE_WEBHOOK_SECRET in Vercel env vars.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret.' });
  }

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const amountPaid = invoice.amount_paid || 0;
      // Skip $0 invoices (trial-start invoices, proration credits, etc.)
      if (amountPaid <= 0) {
        return res.status(200).json({ ignored: 'amount_paid <= 0' });
      }
      const value = amountPaid / 100;
      const currency = (invoice.currency || 'usd').toUpperCase();
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      let email = invoice.customer_email;
      if (!email && customerId) {
        try {
          const customer = await stripe().customers.retrieve(customerId);
          if (customer && !customer.deleted) email = customer.email;
        } catch {
          // ignore
        }
      }
      const eventId = `pur-${invoice.id}`;
      await sendCapiEvent({
        eventName: 'Purchase',
        eventId,
        value,
        currency,
        email,
        req,
        customData: { invoice_id: invoice.id, customer_id: customerId },
      });
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error', err);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}
