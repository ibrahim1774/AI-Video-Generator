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
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        {isClaimFlow && loading && (
          <div style={{ color: '#bbb', fontFamily: 'inherit', fontSize: 14 }}>
            Verifying your payment…
          </div>
        )}
        {isClaimFlow && error && !loading && (
          <div
            style={{
              maxWidth: 420,
              padding: '20px 24px',
              borderRadius: 12,
              border: '1px solid rgba(255, 90, 90, 0.35)',
              background: 'rgba(255, 90, 90, 0.06)',
              color: '#ff8a8a',
              fontFamily: 'inherit',
              fontSize: 14,
              textAlign: 'center',
            }}
          >
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
