import { useState } from 'react';

import styles from './Paywall.module.css';

const TOPUPS = [
  { pack: 's', label: '$15', credits: 9 },
  { pack: 'm', label: '$50', credits: 30 },
  { pack: 'l', label: '$100', credits: 60 },
];

export default function Paywall({ entitlement, onTrialStarted, onError }) {
  const [busy, setBusy] = useState(null); // 'monthly' | 'yearly' | 's' | 'm' | 'l'
  const [localError, setLocalError] = useState('');

  const startCheckout = async (plan) => {
    if (busy) return;
    setBusy(plan);
    setLocalError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout.');
      }
      window.location.href = data.url;
    } catch (err) {
      setLocalError(err.message);
      onError && onError(err.message);
      setBusy(null);
    }
  };

  const startTopup = async (pack) => {
    if (busy) return;
    setBusy(pack);
    setLocalError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'topup', pack }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout.');
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
  const showTopups = isSubscriber && !isTrialing;

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.kicker}>\u25c6 Pricing</span>
          <h2 className={styles.title}>
            {showTopups ? 'Need more credits?' : 'Start with a 1-day free trial'}
          </h2>
          <p className={styles.subtitle}>
            {showTopups
              ? 'Buy a top-up pack. Credits never expire and stack on your plan.'
              : "Both plans start with 24 hours free. Cancel anytime during the trial and you won't be charged."}
          </p>
        </header>

        {!showTopups && (
          <div className={styles.tiersTwo}>
            <article className={styles.tier}>
              <div className={styles.tierBadge}>1-day free trial</div>
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Monthly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$9</span>
                  <span className={styles.period}>/ month</span>
                </div>
              </div>
              <ul className={styles.feats}>
                <li>10 video generations / month</li>
                <li>1 day free, then $9/month</li>
                <li>Cancel anytime</li>
                <li>720p or 1080p, no watermark</li>
              </ul>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => startCheckout('monthly')}
                disabled={busy !== null}
              >
                {busy === 'monthly' ? 'Redirecting\u2026' : 'Start free trial \u2192 $9/mo'}
              </button>
            </article>

            <article className={`${styles.tier} ${styles.tierFeatured}`}>
              <div className={styles.tierBadge}>Best value \u00b7 1-day free trial</div>
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Yearly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$69</span>
                  <span className={styles.period}>/ year</span>
                </div>
              </div>
              <ul className={styles.feats}>
                <li>100 video generations / year</li>
                <li>1 day free, then $69/year</li>
                <li>~36% cheaper than monthly</li>
                <li>One charge, cancel anytime</li>
              </ul>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnAccent}`}
                onClick={() => startCheckout('yearly')}
                disabled={busy !== null}
              >
                {busy === 'yearly' ? 'Redirecting\u2026' : 'Start free trial \u2192 $69/yr'}
              </button>
            </article>
          </div>
        )}

        {showTopups && (
          <div className={styles.topupRow}>
            {TOPUPS.map((t) => (
              <button
                key={t.pack}
                type="button"
                className={styles.topupBtn}
                onClick={() => startTopup(t.pack)}
                disabled={busy !== null}
              >
                <span className={styles.topupPrice}>{t.label}</span>
                <span className={styles.topupCredits}>
                  {busy === t.pack ? 'Redirecting\u2026' : `${t.credits} credits`}
                </span>
              </button>
            ))}
          </div>
        )}

        {localError && <div className={styles.error}>{localError}</div>}

        <footer className={styles.footer}>
          <span>\u25c6 Card required</span>
          <span>\u25c6 Powered by Stripe</span>
          <span>
            \u25c6 {showTopups ? 'Top-up credits never expire' : 'Cancel during trial = no charge'}
          </span>
        </footer>
      </div>
    </section>
  );
}
