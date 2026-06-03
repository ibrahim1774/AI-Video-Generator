import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import AuthModal from '../../components/AuthModal';

/*
 * Two flows live on /sign-up:
 *
 *   1. Vanilla signup (no query params) — opens the AuthModal in
 *      signup mode, redirects to / on success.
 *
 *   2. Claim-after-pay (?session_id=cs_...) — user just paid via the
 *      anonymous "pay first, sign up after" flow. We fetch the email
 *      they used at Stripe via /api/stripe-session-info, prefill +
 *      lock the email field, and pass the session_id down so AuthModal
 *      can call /api/checkout/claim after sign-up to link the Stripe
 *      customer to the new Supabase user and grant credits.
 */
export default function SignUpPage() {
  const router = useRouter();
  const [open] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [lockedEmail, setLockedEmail] = useState(null);
  const [claimable, setClaimable] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const sid =
      typeof router.query.session_id === 'string' ? router.query.session_id : null;
    if (!sid) return;
    setSessionId(sid);
    setLoading(true);
    fetch(`/api/stripe-session-info?session_id=${encodeURIComponent(sid)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!data?.email) {
          setError(data?.error || 'We could not find that checkout session.');
          setClaimable(false);
        } else if (!data.claimable) {
          setError(`Payment is not complete (${data.paymentStatus}). Please retry checkout.`);
          setClaimable(false);
        } else {
          setLockedEmail(data.email);
        }
      })
      .catch(() => setError('Could not verify your payment. Please try again.'))
      .finally(() => setLoading(false));
  }, [router.isReady, router.query.session_id]);

  const isClaimFlow = Boolean(sessionId);

  // Optional ?returnTo=/some/path — where to send the user after a
  // successful signup (or after closing the modal). Validated to a
  // same-origin path so this can never be used as an open redirect.
  // When absent, defaults to '/' which preserves the original behavior
  // of /sign-up and /sign-up?session_id=... unchanged.
  const rawReturnTo =
    typeof router.query.returnTo === 'string' ? router.query.returnTo : '';
  const safeReturnTo =
    rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : '/';

  return (
    <>
      <Head>
        <title>{isClaimFlow ? 'Finish setup' : 'Sign up'} — Ariya Lab</title>
      </Head>
      <main
        style={{
          minHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          gap: 20,
        }}
      >
        {isClaimFlow && !loading && !error && (
          <div style={claimEyebrowStyle}>
            ◆ Completing your purchase
          </div>
        )}
        {isClaimFlow && loading && (
          <div style={loadingStyle}>
            <span style={loadingSpinnerStyle} />
            Verifying your payment…
          </div>
        )}
        {isClaimFlow && error && !loading && (
          <div style={errorCardStyle}>
            <div style={errorIconStyle}>⚠</div>
            {error}
          </div>
        )}
        {(!isClaimFlow || (lockedEmail && claimable)) && (
          <AuthModal
            open={open}
            onClose={() => (window.location.href = safeReturnTo)}
            initialMode="signup"
            redirectTo={safeReturnTo}
            lockedEmail={lockedEmail}
            claimSessionId={sessionId}
          />
        )}
      </main>
    </>
  );
}

/* ── Premium "Obsidian & Platinum" styles for sign-up page ── */

const claimEyebrowStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--text-dim, #a6a6ad)',
};

const loadingStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: 'var(--font-body, sans-serif)',
  fontSize: 14,
  color: 'var(--text-dim, #a6a6ad)',
  letterSpacing: '0.02em',
};

const loadingSpinnerStyle = {
  display: 'inline-block',
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '2px solid rgba(255,255,255,0.15)',
  borderTopColor: 'rgba(255,255,255,0.7)',
  animation: 'spin 0.9s linear infinite',
  flexShrink: 0,
};

const errorCardStyle = {
  position: 'relative',
  maxWidth: 420,
  padding: '22px 24px',
  borderRadius: 'var(--radius-xl, 24px)',
  border: '1px solid rgba(232,164,164,0.25)',
  background:
    'linear-gradient(180deg, rgba(232,164,164,0.06) 0%, rgba(232,164,164,0.02) 100%)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: 'inset 0 1px 0 rgba(232,164,164,0.12)',
  color: 'var(--error, #e8a4a4)',
  fontFamily: 'var(--font-body, sans-serif)',
  fontSize: 14,
  textAlign: 'center',
  lineHeight: 1.55,
};

const errorIconStyle = {
  fontSize: 20,
  marginBottom: 10,
  opacity: 0.75,
}
