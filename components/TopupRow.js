import { useEffect, useState } from 'react';

import paywallStyles from './Paywall.module.css';

/*
 * Top-up packs (one-time credit purchases). Used in two places:
 *   - inside Paywall.js, when a subscriber's credits hit zero
 *   - on /dashboard for active subscribers who still have credits
 *     and want to pre-load more (the dashboard hides the full Paywall
 *     when canSwap is true, so without this row there's no entry point)
 *
 * Reuses Paywall.module.css's .topupRow / .topupBtn / .topupPrice /
 * .topupCredits classes so the styling stays in one place.
 */

const TOPUPS = [
  { pack: 's', label: '$15', credits: 12 },
  { pack: 'm', label: '$50', credits: 45 },
  { pack: 'l', label: '$100', credits: 100 },
];

function firePixel(meta) {
  if (!meta?.eventId) return;
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  try {
    window.fbq(
      'track',
      meta.eventName || 'InitiateCheckout',
      { value: meta.value, currency: meta.currency || 'USD' },
      { eventID: meta.eventId }
    );
  } catch {}
}

export default function TopupRow({ returnTo = '/dashboard', onError, onLocalError }) {
  const [busy, setBusy] = useState(null);
  const [localError, setLocalError] = useState('');

  // Reset stuck "Redirecting…" state on BFCache restore (back from Stripe).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPageShow = (e) => {
      if (e.persisted) {
        setBusy(null);
        setLocalError('');
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const startTopup = async (pack) => {
    if (busy) return;
    setBusy(pack);
    setLocalError('');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'topup', pack, returnTo }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout.');
      }
      firePixel(data.meta);
      window.location.href = data.url;
    } catch (err) {
      setLocalError(err.message);
      onError && onError(err.message);
      onLocalError && onLocalError(err.message);
      setBusy(null);
    }
  };

  return (
    <>
      <div className={paywallStyles.topupRow}>
        {TOPUPS.map((t) => (
          <button
            key={t.pack}
            type="button"
            className={paywallStyles.topupBtn}
            onClick={() => startTopup(t.pack)}
            disabled={busy !== null}
          >
            <span className={paywallStyles.topupPrice}>{t.label}</span>
            <span className={paywallStyles.topupCredits}>
              {busy === t.pack ? 'Redirecting…' : `${t.credits} credits`}
            </span>
          </button>
        ))}
      </div>
      {localError && (
        <div className={paywallStyles.error} style={{ marginTop: 12 }}>
          {localError}
        </div>
      )}
    </>
  );
}
