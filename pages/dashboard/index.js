import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../../styles/Home.module.css';
import Paywall from '../../components/Paywall';
import { getBrowserSupabase } from '../../lib/supabase';
import { log } from '../../lib/debugLog';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [entitlement, setEntitlement] = useState(null);
  const [paidBanner, setPaidBanner] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const supabase = typeof window !== 'undefined' ? getBrowserSupabase() : null;

  const fetchEntitlement = useCallback(async () => {
    try {
      const r = await fetch('/api/entitlement');
      const data = await r.json();
      setEntitlement(data);
      log('info', 'entitlement', data);
      return data;
    } catch (err) {
      log('error', 'entitlement fetch failed', { message: err.message });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setError('Auth not configured yet. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.');
      return undefined;
    }
    let mounted = true;

    (async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!u) {
        router.replace('/sign-in');
        return;
      }
      setUser(u);

      const params = new URLSearchParams(window.location.search);
      const paid = params.get('paid');
      const sessionId = params.get('session_id');

      if (paid === '1' && sessionId) {
        setConfirming(true);
        try {
          const r = await fetch(
            `/api/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`,
            { method: 'POST' }
          );
          const data = await r.json();
          log(r.ok ? 'info' : 'error', 'checkout confirm', data);
          if (r.ok) {
            setPaidBanner(true);
            // Fire Meta Pixel Purchase event with same event id as CAPI.
            const meta = data.meta || {};
            if (
              meta.eventId &&
              typeof window !== 'undefined' &&
              typeof window.fbq === 'function'
            ) {
              try {
                window.fbq(
                  'track',
                  meta.eventName || 'Purchase',
                  { value: meta.value, currency: meta.currency || 'USD' },
                  { eventID: meta.eventId }
                );
              } catch (e) {
                log('warn', 'pixel threw', { message: e.message });
              }
            }
          } else {
            setError(data.error || 'Could not finalize your subscription.');
          }
        } catch (e) {
          setError(e.message || 'Could not finalize your subscription.');
        } finally {
          setConfirming(false);
          const url = new URL(window.location.href);
          url.searchParams.delete('paid');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', url.toString());
        }
      }

      await fetchEntitlement();
    })();

    return () => {
      mounted = false;
    };
  }, [supabase, router, fetchEntitlement]);

  if (!user) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <p className={styles.subtitle}>Loading…</p>
        </div>
      </main>
    );
  }

  const canSwap = entitlement && entitlement.canSwap;

  return (
    <>
      <Head>
        <title>Dashboard — Haelabs</title>
      </Head>
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ Dashboard</span>
          <h1 className={styles.headline}>
            Welcome, <span className={styles.accent}>{user.email}</span>
          </h1>
          {entitlement && (
            <p className={styles.subtitle}>
              {entitlement.tier === 'trial' || entitlement.status === 'trialing'
                ? `Free trial — ${entitlement.creditsRemaining || 0} credit${entitlement.creditsRemaining === 1 ? '' : 's'} remaining`
                : entitlement.tier === 'monthly' || entitlement.tier === 'yearly'
                ? `${entitlement.tier === 'monthly' ? 'Monthly' : 'Yearly'} plan — ${entitlement.creditsRemaining} credits remaining`
                : 'No active plan. Pick one below to get started.'}
            </p>
          )}
        </div>

        {paidBanner && (
          <div className={styles.banner}>
            ◆ You're subscribed. Head to the upload page to make your first swap.
          </div>
        )}

        {confirming && (
          <div className={styles.banner}>◆ Finalizing your subscription…</div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {canSwap ? (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <a href="/" className={styles.submit + ' ' + styles.submitReady}>
              Go to upload →
            </a>
          </div>
        ) : (
          <Paywall
            entitlement={entitlement}
            onError={(msg) => setError(msg)}
            onTrialStarted={async () => {
              setPaidBanner(false);
              await fetchEntitlement();
            }}
          />
        )}

        <section
          aria-label="Support contact"
          style={{
            maxWidth: 560,
            margin: '48px auto 32px',
            padding: '20px 24px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.02)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 8,
            }}
          >
            Billing or membership questions?
          </div>
          <a
            href="mailto:support@davoxa.com"
            style={{
              color: '#e0c488',
              fontSize: 15,
              fontWeight: 500,
              textDecoration: 'none',
              borderBottom: '1px solid rgba(224, 196, 136, 0.35)',
            }}
          >
            support@davoxa.com
          </a>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: 'rgba(255,255,255,0.55)',
              lineHeight: 1.5,
            }}
          >
            Email us anytime — we usually reply within a business day.
          </div>
        </section>
      </main>
    </>
  );
}
