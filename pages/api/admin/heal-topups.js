import { stripe } from '../../../lib/stripe';
import { getUserFromRequest, getSupabaseAdmin } from '../../../lib/supabaseServer';
import { linkStripeCustomerToProfile } from '../../../lib/entitlement';

/*
 * Admin tool to fix orphaned top-up credits.
 *
 * The bug we're healing: a top-up payment lands credits on a Stripe
 * customer that the user's Supabase profile is not linked to. This
 * happens when /api/checkout/confirm is skipped (user closes the tab
 * before redirect, has no session cookie, etc.) and only the webhook
 * fallback runs — that path grants credits but never wrote
 * stripe_customer_id back to profiles before the recent fix.
 *
 * Inputs:
 *   { email }                — find Supabase user by email + Stripe
 *                              customers by email and report state.
 *   { sessionId }            — load a specific Checkout session, find
 *                              its customer, find the user.
 *   { dryRun: false }        — actually relink. Defaults to dryRun: true
 *                              so the first call always shows what
 *                              would change without changing anything.
 *   { customerId: "cus_..." } — when multiple Stripe customers exist
 *                              for the same email, force which one to
 *                              link (review dryRun output, then call
 *                              again with this).
 *
 * Returns a structured report with all candidate customers, current
 * link state, credits available, and what the heal action would (or
 * did) do. Idempotent — running it twice with dryRun: false on the
 * same already-linked profile is a no-op that re-reports the state.
 *
 * Gated by ADMIN_EMAILS, same as grant-credits.
 */

const DEFAULT_ADMIN_EMAILS = ['ibrahim3709@gmail.com'];
function adminEmails() {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_ADMIN_EMAILS.map((s) => s.toLowerCase());
}

function summarizeCustomer(customer) {
  if (!customer || customer.deleted) return null;
  const md = customer.metadata || {};
  return {
    id: customer.id,
    email: customer.email,
    creditsRemaining: Number.parseInt(md.creditsRemaining || '0', 10) || 0,
    supabaseUserId: md.supabase_user_id || null,
    processedSessions: (md.processedSessions || '').split(',').filter(Boolean),
    plan: md.plan || null,
  };
}

async function findUserByEmail(admin, email) {
  // listUsers caps at 1000; that's fine for the current footprint.
  const { data: usersPage, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`User lookup failed: ${error.message}`);
  return (usersPage?.users || []).find(
    (u) => (u.email || '').toLowerCase() === email.toLowerCase()
  ) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const callerEmail = (session.user.email || '').toLowerCase();
  if (!adminEmails().includes(callerEmail)) {
    return res.status(403).json({ error: 'Admin only.', code: 'NOT_ADMIN' });
  }

  const { email, sessionId, customerId: forcedCustomerId, dryRun } = req.body || {};
  const isDryRun = dryRun !== false; // default true
  const targetEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!targetEmail && !targetSessionId) {
    return res.status(400).json({ error: 'email or sessionId required' });
  }

  try {
    const admin = getSupabaseAdmin();

    let resolvedEmail = targetEmail;
    let candidateCustomerIds = [];

    // Path A: session id — pull customer + email straight from Stripe.
    if (targetSessionId) {
      const cs = await stripe().checkout.sessions.retrieve(targetSessionId);
      const cid = typeof cs.customer === 'string' ? cs.customer : cs.customer?.id;
      if (!cid) {
        return res.status(404).json({ error: 'Session has no customer attached.' });
      }
      candidateCustomerIds = [cid];
      resolvedEmail = (cs.customer_details?.email || cs.customer_email || '').toLowerCase();
    }

    // Path B: email — find every Stripe customer that matches.
    if (!candidateCustomerIds.length && resolvedEmail) {
      const list = await stripe().customers.list({ email: resolvedEmail, limit: 10 });
      candidateCustomerIds = list.data.map((c) => c.id);
    }

    if (!candidateCustomerIds.length) {
      return res.status(404).json({
        error: `No Stripe customer found for ${resolvedEmail || targetSessionId}`,
      });
    }

    // Find the Supabase user (must exist for us to relink to anything).
    const user = await findUserByEmail(admin, resolvedEmail);
    if (!user) {
      return res.status(404).json({
        error: `No Supabase user with email ${resolvedEmail}. Heal aborted.`,
        candidateCustomers: candidateCustomerIds,
      });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    const currentlyLinked = profile?.stripe_customer_id || null;

    // Pull each candidate customer's state for the report.
    const candidates = await Promise.all(
      candidateCustomerIds.map(async (id) => {
        try {
          const c = await stripe().customers.retrieve(id);
          return summarizeCustomer(c);
        } catch {
          return { id, error: 'retrieve failed' };
        }
      })
    );
    const usableCandidates = candidates.filter(Boolean);

    // Decide which customer to link.
    let targetCustomerId = null;
    if (forcedCustomerId) {
      if (!candidateCustomerIds.includes(forcedCustomerId)) {
        return res.status(400).json({
          error: 'forcedCustomerId is not among the candidates for this email.',
          candidates: usableCandidates,
        });
      }
      targetCustomerId = forcedCustomerId;
    } else if (usableCandidates.length === 1) {
      targetCustomerId = usableCandidates[0].id;
    } else {
      // Pick the one with the most credits as the default suggestion,
      // but require an explicit forcedCustomerId to actually heal when
      // there's ambiguity.
      const sorted = [...usableCandidates].sort(
        (a, b) => (b.creditsRemaining || 0) - (a.creditsRemaining || 0)
      );
      const suggestion = sorted[0]?.id || null;
      return res.status(409).json({
        ambiguous: true,
        message: `Multiple Stripe customers for ${resolvedEmail}. Re-run with customerId set to one of them.`,
        suggestion,
        currentlyLinked,
        candidates: usableCandidates,
      });
    }

    const targetSummary = usableCandidates.find((c) => c.id === targetCustomerId) || null;
    const willChange = currentlyLinked !== targetCustomerId;

    if (!willChange) {
      return res.status(200).json({
        ok: true,
        message: 'Profile is already linked to this customer. No action needed.',
        email: resolvedEmail,
        supabaseUserId: user.id,
        currentlyLinked,
        targetCustomerId,
        targetCustomer: targetSummary,
        dryRun: isDryRun,
      });
    }

    if (isDryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        message:
          'Dry run only — re-run with { dryRun: false } to apply. Will change the profile link from currentlyLinked → targetCustomerId.',
        email: resolvedEmail,
        supabaseUserId: user.id,
        currentlyLinked,
        targetCustomerId,
        targetCustomer: targetSummary,
        otherCandidates: usableCandidates.filter((c) => c.id !== targetCustomerId),
      });
    }

    await linkStripeCustomerToProfile(admin, user.id, targetCustomerId);

    // Also backfill supabase_user_id on the customer metadata so future
    // webhook-only paths can self-heal.
    try {
      const cust = await stripe().customers.retrieve(targetCustomerId);
      if (cust && !cust.deleted) {
        const md = cust.metadata || {};
        if (md.supabase_user_id !== user.id) {
          await stripe().customers.update(targetCustomerId, {
            metadata: { ...md, supabase_user_id: user.id },
          });
        }
      }
    } catch (mdErr) {
      console.warn('[admin/heal-topups] metadata backfill failed', mdErr.message);
    }

    return res.status(200).json({
      ok: true,
      dryRun: false,
      message: 'Profile relinked.',
      email: resolvedEmail,
      supabaseUserId: user.id,
      previouslyLinked: currentlyLinked,
      nowLinked: targetCustomerId,
      creditsVisibleToUser: targetSummary?.creditsRemaining ?? null,
    });
  } catch (err) {
    console.error('[admin/heal-topups] failed', err);
    return res.status(500).json({ error: err.message || 'Heal failed.' });
  }
}
