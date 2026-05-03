import { stripe, planFromPrice, topupFromPrice, PLANS, CAPS } from '../../../lib/stripe';
import { linkStripeCustomerToProfile } from '../../../lib/entitlement';
import { getUserFromRequest } from '../../../lib/supabaseServer';
import { sendCapiEvent } from '../../../lib/meta';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { session_id: sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }

  try {
    const checkoutSession = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price', 'subscription', 'customer'],
    });

    // Hard guard: only grant on a session Stripe actually marks as
    // paid (or no_payment_required for trialing subs that haven't
    // been charged yet). Without this, anyone with a session_id
    // could trigger a credit grant on an abandoned/unpaid checkout.
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
        : null) ||
      session.user.email;

    const price = checkoutSession.line_items?.data?.[0]?.price;
    const plan = planFromPrice(price);
    const topup = topupFromPrice(price);

    let eventKind = 'unknown';
    let value;
    let creditsAdded = 0;

    // Idempotency: refresh during the response, browser-back, or a
    // dup tab can fire /confirm twice for the same session_id. Track
    // the last 10 processed session IDs in customer metadata so a
    // re-fire returns success without re-granting. We store a 32-char
    // tail of the session id (Stripe metadata is capped at 500 chars
    // per value).
    const sessionTag = checkoutSession.id.replace(/^cs_(test_|live_)/, '').slice(-32);

    if (plan) {
      const sub = checkoutSession.subscription;
      const periodStartMs =
        ((sub && sub.current_period_start) || Math.floor(Date.now() / 1000)) * 1000;
      const customer = await stripe().customers.retrieve(customerId);
      const md = customer && !customer.deleted ? customer.metadata || {} : {};
      const processed = (md.processedSessions || '').split(',').filter(Boolean);
      const alreadyProcessed = processed.includes(sessionTag);

      if (!alreadyProcessed) {
        const existingCredits = parseInt(md.creditsRemaining || '0', 10) || 0;
        // Trialing yearly subs only get the 2-credit trial pool (tracked
        // separately via TRIAL_CREDITS / trialCreditsUsed). Seeding the
        // full cap here would let the user spend cap+TRIAL_CREDITS during
        // the trial — the entitlement reader treats md.creditsRemaining
        // as top-ups and adds it on top of the trial pool. Leave it at 0
        // (or whatever existing top-ups they have) and let the rollover
        // path in readPaidEntitlement grant the full cap on the
        // trialing → active transition (current_period_start jumps).
        const isTrialing = sub && sub.status === 'trialing';
        const seededCredits = isTrialing
          ? existingCredits
          : Math.max(existingCredits, CAPS[plan]);
        const nextProcessed = [sessionTag, ...processed].slice(0, 10).join(',');
        await stripe().customers.update(customerId, {
          metadata: {
            ...md,
            plan,
            periodStart: String(periodStartMs),
            creditsRemaining: String(seededCredits),
            supabase_user_id: session.user.id,
            videosUsedThisPeriod: '',
            trialUsed: '',
            processedSessions: nextProcessed,
          },
        });
      }
      eventKind = 'subscription';
      value = PLANS[plan].amountCents / 100;
    } else if (topup) {
      const customer = await stripe().customers.retrieve(customerId);
      const md = customer && !customer.deleted ? customer.metadata || {} : {};
      const processed = (md.processedSessions || '').split(',').filter(Boolean);
      const alreadyProcessed = processed.includes(sessionTag);

      if (!alreadyProcessed) {
        const current = parseInt(md.creditsRemaining || '0', 10) || 0;
        const next = current + topup.credits;
        const nextProcessed = [sessionTag, ...processed].slice(0, 10).join(',');
        await stripe().customers.update(customerId, {
          metadata: {
            ...md,
            creditsRemaining: String(next),
            processedSessions: nextProcessed,
          },
        });
        creditsAdded = topup.credits;
      }
      eventKind = 'topup';
      value = topup.amountCents / 100;
    }

    // Bind Stripe customer <-> Supabase profile (authoritative link).
    await linkStripeCustomerToProfile(session.supabase, session.user.id, customerId);

    // Trialing yearly subs paid the $1 trial deposit but not the
    // $49 yet — fire StartTrial with the deposit value. The full
    // $49 Purchase fires from /api/stripe-webhook.js when the trial
    // ends and Stripe bills the first yearly invoice (subscription_
    // cycle).
    const isTrialingSub =
      plan && checkoutSession.subscription?.status === 'trialing';
    const eventName = isTrialingSub ? 'StartTrial' : 'Purchase';
    const eventId = `${isTrialingSub ? 'st' : 'pur'}-${checkoutSession.id}`;
    // Use Stripe's amount_total so we report exactly what was charged
    // today (works for trialing yearly = $1 deposit, monthly = $5,
    // top-ups, and the legacy non-trial flow).
    const actualPaidToday =
      typeof checkoutSession.amount_total === 'number'
        ? checkoutSession.amount_total / 100
        : value;
    const reportedValue = isTrialingSub ? actualPaidToday : value;
    await sendCapiEvent({
      eventName,
      eventId,
      value: reportedValue,
      currency: 'USD',
      email: customerEmail,
      req,
      customData: {
        kind: eventKind,
        plan: plan || undefined,
        pack: topup?.key || undefined,
        supabase_user_id: session.user.id,
      },
    });

    return res.status(200).json({
      ok: true,
      kind: eventKind,
      tier: plan || 'unknown',
      videoCap: plan ? CAPS[plan] : 0,
      creditsAdded,
      meta: { eventId, eventName, value: reportedValue, currency: 'USD' },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
