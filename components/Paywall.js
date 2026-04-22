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
  const [trialBlocked, setTrialBlocked] = useState(false);

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
                : 'Start with a 1-day free trial'}
          </h2>
          <p className={styles.subtitle}>
            {isTrialing
              ? 'Buy a top-up pack to keep going during your trial, or convert to a monthly/yearly plan below.'
              : showTopups
                ? 'Buy a top-up pack. Credits never expire and stack on your plan.'
                : 'Both plans start with 2 free credits — enough for one full UGC clip — for 24 hours. Cancel during the trial and you won\'t be charged.'}
          </p>
          <p className={styles.subtitle} style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
            Each generation uses our most powerful (and pricey) AI models &mdash;
            that's the trade for high-quality output.
          </p>
        </header>

        {trialBlocked && (
          <div
            style={{
              margin: '12px 0',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(224,196,136,0.35)',
              background: 'rgba(224,196,136,0.08)',
              color: '#e8d9af',
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
              {!isTrialing && <div className={styles.tierBadge}>2 credits free for 24h</div>}
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Monthly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$9</span>
                  <span className={styles.period}>/ month</span>
                </div>
              </div>
              <ul className={styles.feats}>
                <li>10 video generations / month</li>
                {isTrialing ? <li>Convert anytime to lock in $9/mo</li> : <li>2 free credits for 24h, then $9/month</li>}
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
                    ? 'Convert to monthly → $9/mo'
                    : 'Start free trial → $9/mo'}
              </button>
            </article>

            <article className={`${styles.tier} ${styles.tierFeatured}`}>
              <div className={styles.tierBadge}>
                {isTrialing ? 'Best value' : 'Best value · 2 credits free for 24h'}
              </div>
              <div className={styles.tierHead}>
                <h3 className={styles.tierName}>Yearly</h3>
                <div className={styles.price}>
                  <span className={styles.amount}>$89</span>
                  <span className={styles.period}>/ year</span>
                </div>
              </div>
              <ul className={styles.feats}>
                <li>50 video generations / year</li>
                {isTrialing ? <li>Convert anytime to lock in $89/yr</li> : <li>2 free credits for 24h, then $89/year</li>}
                <li>~18% cheaper than monthly</li>
                <li>One charge, cancel anytime</li>
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
                    ? 'Convert to yearly → $89/yr'
                    : 'Start free trial → $89/yr'}
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
                  {busy === t.pack ? 'Redirecting…' : `${t.credits} credits`}
                </span>
              </button>
            ))}
          </div>
        )}

        {localError && <div className={styles.error}>{localError}</div>}

        <footer className={styles.footer}>
          <span>◆ Card required</span>
          <span>◆ Powered by Stripe</span>
          <span>
            ◆ {showTopups ? 'Top-up credits never expire' : 'Cancel during trial = no charge'}
          </span>
        </footer>
      </div>
    </section>
  );
}
