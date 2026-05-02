import { stripe } from '../../../lib/stripe';
import { getUserFromRequest, getSupabaseAdmin } from '../../../lib/supabaseServer';

/*
 * Admin tool to manually grant credits to a user by email.
 *
 * Gated by the existing ADMIN_EMAILS allowlist (defaults to
 * ibrahim3709@gmail.com — same list lib/entitlement.js uses for the
 * unlimited-admin tier).
 *
 * Body: { email, credits }
 *   - email: target user email
 *   - credits: positive integer to ADD to their creditsRemaining
 *
 * Returns: { ok, beforeCredits, afterCredits, customerId, supabaseUserId }
 *   or { error, code } on failure (codes: NO_USER, NO_CUSTOMER, NOT_ADMIN).
 */

const DEFAULT_ADMIN_EMAILS = ['ibrahim3709@gmail.com'];
function adminEmails() {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_ADMIN_EMAILS.map((s) => s.toLowerCase());
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

  const { email, credits } = req.body || {};
  const targetEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const amount = Number.parseInt(credits, 10);
  if (!targetEmail) return res.status(400).json({ error: 'email required' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    return res.status(400).json({ error: 'credits must be a positive integer (max 10000)' });
  }

  try {
    const admin = getSupabaseAdmin();

    // Look up Supabase user by email. The auth.users table isn't directly
    // queryable via the service-role client's normal `.from('users')`
    // surface — use the admin auth API.
    const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) {
      return res.status(500).json({ error: `User lookup failed: ${listErr.message}` });
    }
    const targetUser = (usersPage?.users || []).find(
      (u) => (u.email || '').toLowerCase() === targetEmail
    );
    if (!targetUser) {
      return res.status(404).json({
        error: `No Supabase user with email ${targetEmail}.`,
        code: 'NO_USER',
      });
    }

    // Find their Stripe customer via profiles.
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', targetUser.id)
      .maybeSingle();
    if (profileErr) {
      return res.status(500).json({ error: `Profile lookup failed: ${profileErr.message}` });
    }
    const customerId = profile?.stripe_customer_id;
    if (!customerId) {
      return res.status(404).json({
        error: `User has no linked Stripe customer (never subscribed or bought a top-up).`,
        code: 'NO_CUSTOMER',
        supabaseUserId: targetUser.id,
      });
    }

    // Read current credits and add.
    const customer = await stripe().customers.retrieve(customerId);
    if (customer.deleted) {
      return res.status(404).json({ error: 'Stripe customer was deleted.', code: 'NO_CUSTOMER' });
    }
    const md = customer.metadata || {};
    const before = Number.parseInt(md.creditsRemaining || '0', 10) || 0;
    const after = before + amount;
    await stripe().customers.update(customerId, {
      metadata: { ...md, creditsRemaining: String(after) },
    });

    return res.status(200).json({
      ok: true,
      email: targetUser.email,
      supabaseUserId: targetUser.id,
      customerId,
      beforeCredits: before,
      afterCredits: after,
      added: amount,
    });
  } catch (err) {
    console.error('[admin/grant-credits] failed', err);
    return res.status(500).json({ error: err.message || 'Grant failed.' });
  }
}
