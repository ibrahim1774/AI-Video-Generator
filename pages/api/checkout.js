import { stripe, getOrCreatePrice, getOrCreateTopupPrice, TOPUPS } from '../../lib/stripe';
import { getUserFromRequest, getSupabaseAdmin } from '../../lib/supabaseServer';

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

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });
  const email = session.user.email;

  const { plan, mode, pack } = req.body || {};

  const origin =
    process.env.APP_URL ||
    (req.headers.origin && req.headers.origin.replace(/\/$/, '')) ||
    `https://${req.headers.host}`;

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
        success_url: `${origin}/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/dashboard?paid=0`,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        metadata: { supabase_user_id: session.user.id },
      });
      return res.status(200).json({ url: checkout.url });
    }

    if (plan !== 'monthly' && plan !== 'yearly') {
      return res.status(400).json({
        error: "Expected { plan: 'monthly'|'yearly' } or { mode: 'topup', pack: 's'|'m'|'l' }.",
      });
    }

    const trialBlocked = await isTrialBlockedForIp(session.user.id, req);

    const price = await getOrCreatePrice(plan);
    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: price.id, quantity: 1 }],
      customer_email: email,
      success_url: `${origin}/dashboard?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard?paid=0`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        ...(trialBlocked ? {} : { trial_period_days: 1 }),
        metadata: { supabase_user_id: session.user.id },
      },
      metadata: { supabase_user_id: session.user.id },
    });
    return res.status(200).json({ url: checkout.url, trialBlocked });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
