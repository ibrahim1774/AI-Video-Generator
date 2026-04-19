import { stripe, PLAN_BY_PRICE } from '../../lib/stripe';

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
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const lineItems = await stripe().checkout.sessions.listLineItems(session.id, {
          limit: 1,
        });
        const priceId = lineItems.data?.[0]?.price?.id;
        const plan = PLAN_BY_PRICE[priceId];
        if (customerId && plan) {
          await stripe().customers.update(customerId, {
            metadata: {
              plan,
              periodStart: String(Date.now()),
              videosUsedThisPeriod: '0',
            },
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = PLAN_BY_PRICE[priceId];
        if (customerId && plan) {
          // Period rollover detection: Stripe ships current_period_start
          await stripe().customers.update(customerId, {
            metadata: {
              plan,
              periodStart: String((sub.current_period_start || Math.floor(Date.now() / 1000)) * 1000),
              videosUsedThisPeriod: '0',
            },
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (customerId) {
          await stripe().customers.update(customerId, {
            metadata: { plan: '', videosUsedThisPeriod: '0' },
          });
        }
        break;
      }
      default:
        // ignore other events
        break;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}
