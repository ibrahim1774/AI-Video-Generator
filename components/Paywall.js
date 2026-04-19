import { useState } from 'react';

import styles from './Paywall.module.css';

export default function Paywall({ onTrialStarted, onError }) {
  const [busy, setBusy] = useState(null); // 'monthly' | 'yearly' | 'dev'
  const [localError, setLocalError] = useState('');

  const startDev = async () => {
    if (busy) return;
    setBusy('dev');
    setLocalError('');
    try {
      const res = await fetch('/api/start-dev', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to enable dev mode.');
      }
      onTrialStarted && onTrialStarted();
    } catch (err) {
      setLocalError(err.message);
      onError && onError(err.message);
    } finally {
      setBusy(null);
    }
  };

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

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.kicker}>\u25c6 Pricing</span>
          <h2 className={styles.title}>Start with a 1-day free trial</h2>
          <p className={styles.subtitle}>
            Both plans start with 24 hours free. Cancel anytime during the trial and you won't be charged.
          </p>
        </header>

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

        {localError && <div className={styles.error}>{localError}</div>}

        <footer className={styles.footer}>
          <span>\u25c6 Card required</span>
          <span>\u25c6 Powered by Stripe</span>
          <span>\u25c6 Cancel during trial = no charge</span>
        </footer>

        <button
          type="button"
          className={styles.devBtn}
          onClick={startDev}
          disabled={busy !== null}
        >
          {busy === 'dev' ? 'Enabling\u2026' : 'Dev: enable unlimited (testing only)'}
        </button>
      </div>
    </section>
  );
}
