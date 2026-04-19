import { useState } from 'react';

import styles from './Paywall.module.css';

export default function Paywall({ entitlement, onTrialStarted, onError }) {
  const [busy, setBusy] = useState(null); // 'trial' | 'monthly' | 'yearly'
  const [localError, setLocalError] = useState('');

  const trialAlreadyUsed =
    entitlement && entitlement.tier === 'trial' && (entitlement.expired || entitlement.videosUsed >= entitlement.videoCap);

  const startTrial = async () => {
    if (busy) return;
    setBusy('trial');
    setLocalError('');
    try {
      const res = await fetch('/api/start-trial', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start trial.');
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
          <span className={styles.kicker}>◆ Pricing</span>
          <h2 className={styles.title}>
            {trialAlreadyUsed ? 'Trial used — pick a plan to keep going' : 'Get started with a 1-day free trial'}
          </h2>
          <p className={styles.subtitle}>
            {trialAlreadyUsed
              ? 'Your free trial has ended or you used your free generation. Upgrade to keep going.'
              : '1 free video in 24 hours. No card. Upgrade anytime.'}
          </p>
        </header>

        <div className={styles.tiers}>
          <article className={`${styles.tier} ${trialAlreadyUsed ? styles.tierDisabled : ''}`}>
            <div className={styles.tierHead}>
              <h3 className={styles.tierName}>Free trial</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$0</span>
                <span className={styles.period}>/ 1 day</span>
              </div>
            </div>
            <ul className={styles.feats}>
              <li>1 video generation</li>
              <li>24 hours of access</li>
              <li>No card required</li>
            </ul>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={startTrial}
              disabled={busy !== null || trialAlreadyUsed}
            >
              {trialAlreadyUsed ? 'Trial used' : busy === 'trial' ? 'Starting…' : 'Start free trial'}
            </button>
          </article>

          <article className={styles.tier}>
            <div className={styles.tierHead}>
              <h3 className={styles.tierName}>Monthly</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$9</span>
                <span className={styles.period}>/ month</span>
              </div>
            </div>
            <ul className={styles.feats}>
              <li>10 video generations / month</li>
              <li>Cancel anytime</li>
              <li>720p or 1080p, no watermark</li>
            </ul>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => startCheckout('monthly')}
              disabled={busy !== null}
            >
              {busy === 'monthly' ? 'Redirecting…' : 'Choose monthly'}
            </button>
          </article>

          <article className={`${styles.tier} ${styles.tierFeatured}`}>
            <div className={styles.tierBadge}>Best value</div>
            <div className={styles.tierHead}>
              <h3 className={styles.tierName}>Yearly</h3>
              <div className={styles.price}>
                <span className={styles.amount}>$69</span>
                <span className={styles.period}>/ year</span>
              </div>
            </div>
            <ul className={styles.feats}>
              <li>100 video generations / year</li>
              <li>~36% cheaper than monthly</li>
              <li>One charge, no surprises</li>
            </ul>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnAccent}`}
              onClick={() => startCheckout('yearly')}
              disabled={busy !== null}
            >
              {busy === 'yearly' ? 'Redirecting…' : 'Choose yearly'}
            </button>
          </article>
        </div>

        {localError && <div className={styles.error}>{localError}</div>}

        <footer className={styles.footer}>
          <span>◆ Encrypted</span>
          <span>◆ Powered by Stripe</span>
          <span>◆ Cancel anytime</span>
        </footer>
      </div>
    </section>
  );
}
