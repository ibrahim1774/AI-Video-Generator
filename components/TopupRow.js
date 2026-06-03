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
 *
 * Image-credit display inflation: when the host paywall is an image-
 * feature surface ('glow-up' or 'interior-design'), the image-pack
 * credit counts render multiplied by IMAGE_DISPLAY_MULTIPLIER and a
 * "(= N images)" sub-line shows the literal allowance. Internal Stripe
 * accounting is unchanged — purchases still grant the literal counts.
 */

const IMAGE_DISPLAY_MULTIPLIER = 10;

const VIDEO_PACKS = [
  { pack: 's', label: '$15', credits: 2280 },
  { pack: 'm', label: '$50', credits: 7600 },
  { pack: 'l', label: '$100', credits: 15200 },
];

const IMAGE_PACKS = [
  { pack: 'image-s', label: '$5', credits: 50 },
  { pack: 'image-m', label: '$15', credits: 200 },
  { pack: 'image-l', label: '$30', credits: 500 },
];

const IMAGE_NOUNS = {
  'glow-up': 'images',
  'interior-design': 'redesigns',
};

function firePixel(meta, content) {
  if (!meta?.eventId) return;
  if (typeof window === 'undefined') return;
  const name = meta.eventName || 'InitiateCheckout';
  const baseParams = { value: meta.value, currency: meta.currency || 'USD' };
  const id = content?.content_id || 'topup';
  const displayName = content?.content_name || id;
  const ttParams = {
    ...baseParams,
    contents: [
      { content_id: id, content_type: 'product', content_name: displayName },
    ],
    content_type: 'product',
  };
  if (typeof window.fbq === 'function') {
    try {
      window.fbq('track', name, baseParams, { eventID: meta.eventId });
    } catch {}
  }
  if (window.ttq && typeof window.ttq.track === 'function') {
    try {
      // TikTok funnel: AddToCart precedes InitiateCheckout. Fire both
      // here at click-time with the same eventId — TikTok dedupes
      // per (event_name, event_id) so distinct names with the same
      // id co-exist.
      window.ttq.track('AddToCart', ttParams, { event_id: meta.eventId });
      window.ttq.track(name, ttParams, { event_id: meta.eventId });
    } catch {}
  }
}

export default function TopupRow({
  returnTo = '/dashboard',
  onError,
  onLocalError,
  surface = 'video',
}) {
  const inflateImage = surface === 'glow-up' || surface === 'interior-design';
  const imageNoun = IMAGE_NOUNS[surface] || 'images';
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
      firePixel(data.meta, {
        content_id: `topup-${pack}`,
        content_name: `topup ${pack}`,
      });
      window.location.href = data.url;
    } catch (err) {
      setLocalError(err.message);
      onError && onError(err.message);
      onLocalError && onLocalError(err.message);
      setBusy(null);
    }
  };

  const renderRow = (heading, packs, creditLabel, inflate, subNoun) => (
    <>
      <div className={paywallStyles.topupGroupHead} style={groupHeadStyle}>
        <span style={groupTitleStyle}>{heading}</span>
      </div>
      <div className={paywallStyles.topupRow}>
        {packs.map((t, i) => {
          const display = inflate ? t.credits * IMAGE_DISPLAY_MULTIPLIER : t.credits;
          const isBusy = busy === t.pack;
          const isMiddle = i === 1;
          return (
            <button
              key={t.pack}
              type="button"
              style={isMiddle ? bestValueBtnStyle : topupBtnStyle}
              onClick={() => startTopup(t.pack)}
              disabled={busy !== null}
            >
              {isMiddle && (
                <span style={bestValueBadgeStyle}>Best value</span>
              )}
              <span style={priceStyle}>{t.label}</span>
              <span style={creditsStyle}>
                {isBusy
                  ? 'Redirecting…'
                  : `${display.toLocaleString()} ${creditLabel}`}
              </span>
              {inflate && (
                <span style={{ ...creditsStyle, opacity: 0.6, marginTop: 2 }}>
                  = {t.credits} {subNoun}
                </span>
              )}
              <span style={buyLabelStyle}>{isBusy ? '…' : 'Buy'}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      {renderRow('Video credits', VIDEO_PACKS, 'video credits', false)}
      {renderRow('Image credits', IMAGE_PACKS, 'image credits', inflateImage, imageNoun)}
      {localError && (
        <div className={paywallStyles.error} style={{ marginTop: 12 }}>
          {localError}
        </div>
      )}
    </>
  );
}

/* ── Premium "Obsidian & Platinum" styles for TopupRow ── */

const groupHeadStyle = {
  marginBottom: 10,
};

const groupTitleStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text-dim, #a6a6ad)',
};

const topupBtnStyle = {
  position: 'relative',
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.018) 100%)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-lg, 18px)',
  padding: '18px 14px 14px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  transition: 'transform 0.18s ease, box-shadow 0.2s ease, border-color 0.2s ease',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)',
  color: 'var(--text, #f6f6f7)',
};

const bestValueBtnStyle = {
  ...topupBtnStyle,
  background:
    'radial-gradient(130% 100% at 50% -10%, rgba(255,255,255,0.1), transparent 60%), ' +
    'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.16), 0 8px 28px -10px rgba(255,255,255,0.18)',
  transform: 'translateY(-2px)',
};

const bestValueBadgeStyle = {
  position: 'absolute',
  top: -10,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'linear-gradient(180deg, #ffffff 0%, #d6d6db 100%)',
  color: '#0a0a0b',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '3px 10px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
};

const priceStyle = {
  fontFamily: 'var(--font-display, Georgia, serif)',
  fontSize: 26,
  fontWeight: 600,
  color: 'var(--text, #f6f6f7)',
  letterSpacing: '-0.01em',
};

const creditsStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-dim, #a6a6ad)',
};

const buyLabelStyle = {
  marginTop: 8,
  padding: '6px 18px',
  borderRadius: 'var(--radius-sm, 8px)',
  background: 'linear-gradient(180deg, #ffffff 0%, #d6d6db 100%)',
  color: '#0a0a0b',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.12), ' +
    '0 4px 14px -6px rgba(255,255,255,0.28)',
};
