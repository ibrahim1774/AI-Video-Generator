import { useEffect, useState } from 'react';

import paywallStyles from './Paywall.module.css';

/*
 * Top-up packs (one-time credit purchases). Two clearly-labeled groups:
 *   - Video credits — for face-swap / UGC / image-to-video
 *   - Image credits — for Glow Up and any future image features
 *
 * The two pools never mix; pricing/credit-counts are configured in
 * lib/stripe.js (TOPUPS map, with `kind: 'video' | 'image'`).
 *
 * Used by:
 *   - components/Paywall.js — when a subscriber's credits hit zero
 *   - pages/dashboard — for active subscribers who want to pre-load more
 */

const VIDEO_PACKS = [
  { pack: 's', label: '$15', credits: 12 },
  { pack: 'm', label: '$50', credits: 45 },
  { pack: 'l', label: '$100', credits: 100 },
];

const IMAGE_PACKS = [
  { pack: 'image-s', label: '$5', credits: 50 },
  { pack: 'image-m', label: '$15', credits: 200 },
  { pack: 'image-l', label: '$30', credits: 500 },
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

  const renderRow = (heading, packs, creditLabel) => (
    <>
      <div className={paywallStyles.topupGroupHead}>
        <span className={paywallStyles.topupGroupTitle}>{heading}</span>
      </div>
      <div className={paywallStyles.topupRow}>
        {packs.map((t) => (
          <button
            key={t.pack}
            type="button"
            className={paywallStyles.topupBtn}
            onClick={() => startTopup(t.pack)}
            disabled={busy !== null}
          >
            <span className={paywallStyles.topupPrice}>{t.label}</span>
            <span className={paywallStyles.topupCredits}>
              {busy === t.pack ? 'Redirecting…' : `${t.credits} ${creditLabel}`}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      {renderRow('Video credits', VIDEO_PACKS, 'video credits')}
      {renderRow('Image credits', IMAGE_PACKS, 'image credits')}
      {localError && (
        <div className={paywallStyles.error} style={{ marginTop: 12 }}>
          {localError}
        </div>
      )}
    </>
  );
}
