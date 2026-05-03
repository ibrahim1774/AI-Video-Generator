import { useEffect, useState } from 'react';

import styles from './Paywall.module.css';
import TopupRow from './TopupRow';

export default function Paywall({ entitlement, onTrialStarted, onError, returnTo }) {
  const [busy, setBusy] = useState(null); // 'monthly' | 'yearly' | 's' | 'm' | 'l'
  const [localError, setLocalError] = useState('');
  const [trialBlocked, setTrialBlocked] = useState(false);

  // After redirecting to Stripe, the user may hit Back to return here.
  // Modern browsers restore the page from BFCache without re-running
  // useEffect or remounting, so the `busy` state stays set and the
  // button keeps saying "Redirecting…". The pageshow event fires on
  // BFCache restore (event.persisted === true) — we use it to reset
  // the transient state to its initial values.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPageShow = (e) => {
      if (e.persisted) {
        setBusy(null);
        setTrialBlocked(false);
        setLocalError('');
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Fire the browser pixel for InitiateCheckout if the API returned
  // matching meta. Same eventID as the server CAPI call dedupes them.
  const firePixel = (meta) => {
    if (!meta?.eventId) return;
    if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
    try {
      window.fbq(
        'track',
        meta.eventName || 'InitiateCheckout',
        {
          value: meta.value,
          currency: meta.currency || 'USD',
        },
        { eventID: meta.eventId }
      );
    } catch {}
  };

  const startCheckout = async (plan) => {
    if (busy) return;
    setBusy(plan);
    setLocalError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, returnTo }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout.');
      }
      firePixel(data.meta);
      if (data.trialBlocked) {
        setTrialBlocked(true);
        // Delay the redirect so the user sees the note before Stripe loads.
        setTimeout(() => { window.location.href = data.url; }, 1500);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setLocalError(err.message);
      onError && onError(err.message);
      setBusy(null);
    }
  };

  const isSubscriber =
    entitlement && (entitlement.tier === 'monthly' || entitlement.tier === 'yearly');
  const isTrialing = entitlement && entitlement.status === 'trialing';
  // Top-ups available to anyone with a Stripe customer (subscriber or
  // trialing). Trialing users who burn their 2 free credits can buy a
  // pack to keep going without ending the trial.
  const showTopups = isSubscriber;
  // Plan cards: show for new visitors (no sub) AND for trialing users
  // who may want to convert before their trial ends. Hidden for fully
  // active paid subscribers.
  const showPlans = !isSubscriber || isTrialing;

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.kicker}>◆ Pricing</span>
          <h2 className={styles.title}>
            {isTrialing
              ? 'Add more credits or upgrade'
              : showTopups
                ? 'Need more credits?'
                : 'Pick a plan'}
          </h2>
          <p className={styles.subtitle}>
            {isTrialing
              ? 'Buy a top-up pack to keep going during your trial, or convert to a monthly/yearly plan below.'
              : showTopups
                ? 'Buy a top-up pack. Credits never expire and stack on your plan.'
                : 'Start your 1-day paid trial for $1. Cancel anytime in 24h to avoid the $49 charge.'}
          </p>
        </header>

        {trialBlocked && (
          <div
            style={{
              margin: '12px 0',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255,0.35)',
              background: 'rgba(255, 255, 255,0.08)',
              color: '#e6e6e6',
              fontSize: 13,
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            Looks like someone on this network already used the free trial.
            Your plan will start charging immediately — redirecting to
            checkout&hellip;
          </div>
        )}

        {showPlans && (
          <div className={styles.tiersTwo}>
            <article className={styles.tier}>
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Monthly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$5</span>
                  <span className={styles.period}>/ month</span>
                </div>
              </div>
              <ul className={styles.feats}>
                <li>4 credits / month</li>
                <li>Cancel anytime</li>
                <li>720p or 1080p, no watermark</li>
              </ul>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => startCheckout('monthly')}
                disabled={busy !== null}
              >
                {busy === 'monthly'
                  ? 'Redirecting…'
                  : isTrialing
                    ? 'Convert to monthly → $5/mo'
                    : 'Subscribe → $5/mo'}
              </button>
            </article>

            <article className={`${styles.tier} ${styles.tierFeatured}`}>
              <div className={styles.tierBadge}>
                {isTrialing ? 'Best value' : 'Best value · 1-day paid trial · $1'}
              </div>
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Yearly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$49</span>
                  <span className={styles.period}>/ year</span>
                </div>
              </div>
              <ul className={styles.feats}>
                {isTrialing
                  ? <li>Convert anytime to lock in $49/yr (48 credits)</li>
                  : <li>$1 today &middot; $49/year after, unless cancelled in 24h</li>}
                <li>48 credits / year</li>
                <li>Save 18% vs monthly &middot; cancel anytime</li>
              </ul>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnAccent}`}
                onClick={() => startCheckout('yearly')}
                disabled={busy !== null}
              >
                {busy === 'yearly'
                  ? 'Redirecting…'
                  : isTrialing
                    ? 'Convert to yearly → $49/yr'
                    : 'Start trial → $1 today'}
              </button>
            </article>
          </div>
        )}

        {showTopups && (
          <TopupRow returnTo={returnTo} onError={onError} onLocalError={setLocalError} />
        )}

        {localError && <div className={styles.error}>{localError}</div>}

        <footer className={styles.footer}>
          <span>◆ Card required</span>
          <span>◆ Powered by Stripe</span>
          <span>
            ◆ {showTopups ? 'Top-up credits never expire' : 'Cancel anytime'}
          </span>
        </footer>
      </div>
    </section>
  );
}
