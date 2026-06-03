import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import paywallStyles from '../components/Paywall.module.css';
import TopupRow from '../components/TopupRow';
import Paywall from '../components/Paywall';
import { getBrowserSupabase } from '../lib/supabase';
import { subscribeEntitlement } from '../lib/entitlementBus';

/*
 * Dedicated top-up page.
 *
 *   - Anon → redirect to /sign-in (middleware) or 'Sign in to buy'
 *   - Authed without active sub → show top-up packs (preview) PLUS
 *     a "subscribe first" notice and the full Paywall below.
 *     Clicking a top-up button without a sub hits /api/checkout and
 *     gets a 401; the TopupRow surfaces that as an inline error.
 *   - Authed with active sub → balances at top, top-up packs, no
 *     Paywall.
 *
 * The TopupRow component is reused from /dashboard and the inline
 * Paywall, so pack pricing and Stripe wiring stay in one place.
 */
export default function TopupPage() {
  const [user, setUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [entitlement, setEntitlement] = useState(null);
  const [imageBalance, setImageBalance] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setAuthLoaded(true);
      return undefined;
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data?.user || null);
      setAuthLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  const fetchEntitlement = useCallback(async () => {
    try {
      const r = await fetch('/api/entitlement');
      if (!r.ok) return;
      const d = await r.json();
      setEntitlement(d);
    } catch (err) {
      setError(err.message || 'Could not load credit balance.');
    }
  }, []);

  const fetchImageBalance = useCallback(async () => {
    try {
      const r = await fetch('/api/glow-up');
      if (!r.ok) return;
      const d = await r.json();
      if (d && typeof d.imageCreditsRemaining === 'number') setImageBalance(d);
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    fetchEntitlement();
    fetchImageBalance();
    const unsub = subscribeEntitlement(() => {
      fetchEntitlement();
      fetchImageBalance();
    });
    return unsub;
  }, [user, fetchEntitlement, fetchImageBalance]);

  if (!authLoaded) {
    return (
      <main style={pageStyle}>
        <p style={subtitleStyle}>Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <>
        <Head><title>Top up credits — Ariya Lab</title></Head>
        <main style={pageStyle}>
          <div style={heroStyle}>
            <span style={eyebrowStyle}>◆ Top up</span>
            <h1 style={titleStyle}>Sign in to buy credits</h1>
            <p style={subtitleStyle}>
              You need an account before you can purchase credits.
            </p>
            <Link href="/sign-in" style={linkBtnStyle}>Sign in →</Link>
          </div>
        </main>
      </>
    );
  }

  const isSubscriber =
    entitlement &&
    (entitlement.tier === 'monthly' ||
      entitlement.tier === 'pro' ||
      entitlement.tier === 'yearly' ||
      entitlement.tier === 'admin');

  const videoCreditsRemaining = entitlement?.creditsRemaining ?? 0;
  const imageCreditsRemainingInternal = imageBalance?.imageCreditsRemaining ?? 0;
  const imageCreditsDisplay = imageCreditsRemainingInternal * 10;

  return (
    <>
      <Head><title>Top up credits — Ariya Lab</title></Head>
      <main style={pageStyle}>
        <div style={heroStyle}>
          <span style={eyebrowStyle}>◆ Top up</span>
          <h1 style={titleStyle}>
            {isSubscriber ? 'Buy more credits' : 'Top-up credit packs'}
          </h1>
          <p style={subtitleStyle}>
            {isSubscriber
              ? 'Credits never expire and stack on your plan’s monthly allowance.'
              : 'Preview the top-up packs below. Top-ups stack on an active subscription — start a plan further down to enable them.'}
          </p>
        </div>

        <section className={paywallStyles.card} style={cardOverride}>
          {isSubscriber && (
            <div style={balancesStyle}>
              <div style={balanceItemStyle}>
                <span style={balanceLabelStyle}>Video credits</span>
                <span style={balanceValueStyle}>{videoCreditsRemaining}</span>
                <span style={balanceSubStyle}>
                  Face Swap · UGC · Image-to-Video
                </span>
              </div>
              <div style={balanceItemStyle}>
                <span style={balanceLabelStyle}>Image credits</span>
                <span style={balanceValueStyle}>
                  {imageCreditsDisplay.toLocaleString()}
                </span>
                <span style={balanceSubStyle}>
                  = {imageCreditsRemainingInternal} images · Glow Up · AI Interior
                </span>
              </div>
            </div>
          )}

          {!isSubscriber && (
            <div style={subscribeNoticeStyle}>
              ◆ Top-up purchases require an active subscription. Start a plan
              below first, then come back any time to add more credits.
            </div>
          )}

          <TopupRow returnTo="/topup" onError={(msg) => setError(msg)} />

          {error && <div className={paywallStyles.error}>{error}</div>}

          {isSubscriber && (
            <footer style={footerStyle}>
              <Link href="/dashboard" style={smallLinkStyle}>← Back to dashboard</Link>
            </footer>
          )}
        </section>

        {!isSubscriber && (
          <div style={{ marginTop: 32 }}>
            <Paywall
              entitlement={entitlement}
              returnTo="/topup"
              onError={(msg) => setError(msg)}
              onTrialStarted={() => fetchEntitlement()}
            />
          </div>
        )}
      </main>
    </>
  );
}

const pageStyle = {
  maxWidth: 980,
  margin: '0 auto',
  padding: '32px 20px 80px',
  color: 'var(--text, #ededed)',
};

const heroStyle = {
  textAlign: 'center',
  marginBottom: 24,
};

const eyebrowStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-dim, #a6a6ad)',
};

const titleStyle = {
  margin: '6px 0 6px',
  fontFamily: 'var(--font-display, Georgia, serif)',
  fontSize: 'clamp(24px, 3.6vw, 32px)',
  letterSpacing: '-0.01em',
  fontWeight: 600,
  lineHeight: 1.15,
};

const subtitleStyle = {
  margin: '0 auto',
  maxWidth: 600,
  color: 'var(--text-dim, #a6a6ad)',
  fontSize: 14,
  lineHeight: 1.5,
};

const cardOverride = {
  position: 'relative',
  background:
    'radial-gradient(130% 70% at 50% -10%, rgba(255,255,255,0.06), transparent 56%), ' +
    'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)), ' +
    'rgba(10,10,12,0.5)',
  backdropFilter: 'blur(16px) saturate(130%)',
  WebkitBackdropFilter: 'blur(16px) saturate(130%)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), var(--shadow-xl)',
  color: 'var(--text, #f6f6f7)',
  borderRadius: 'var(--radius-2xl, 32px)',
};

const balancesStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginBottom: 18,
};

const balanceItemStyle = {
  position: 'relative',
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.018) 100%)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-lg, 18px)',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)',
};

const balanceLabelStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text-dim, #a6a6ad)',
};

const balanceValueStyle = {
  fontFamily: 'var(--font-display, Georgia, serif)',
  fontSize: 28,
  fontWeight: 600,
  color: 'var(--text, #f6f6f7)',
  letterSpacing: '-0.01em',
};

const balanceSubStyle = {
  fontSize: 12,
  color: 'var(--text-faint, #5e5e66)',
};

const subscribeNoticeStyle = {
  padding: '12px 14px',
  marginBottom: 16,
  borderRadius: 'var(--radius-md, 12px)',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-dim, #a6a6ad)',
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: 'center',
};

const footerStyle = {
  marginTop: 16,
  textAlign: 'center',
};

const smallLinkStyle = {
  fontSize: 13,
  color: 'var(--text-dim, #a6a6ad)',
  textDecoration: 'none',
  borderBottom: '1px solid rgba(255,255,255,0.18)',
  transition: 'color 0.2s ease, border-color 0.2s ease',
};

const linkBtnStyle = {
  display: 'inline-block',
  marginTop: 14,
  padding: '11px 22px',
  background: 'linear-gradient(180deg, #ffffff 0%, #d6d6db 100%)',
  color: '#0a0a0b',
  borderRadius: 'var(--radius-md, 12px)',
  fontFamily: 'var(--font-body, sans-serif)',
  fontWeight: 600,
  fontSize: 14,
  textDecoration: 'none',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.12), ' +
    '0 10px 28px -10px rgba(255,255,255,0.32)',
  transition: 'transform 0.18s ease, box-shadow 0.25s ease',
};
