import Head from 'next/head';
import Script from 'next/script';
import { useEffect, useState } from 'react';

import styles from '../../styles/Home.module.css';
import Paywall from '../../components/Paywall';

/*
 * /local-business/pricing-plan — pay-first landing for the Local
 * Business funnel.
 *
 * Same headline, subheadline, and demo reel as /local-business, but
 * the page is the PAYWALL — no creator form. Clicking Subscribe runs
 * the leak-protected ticket flow (see pages/api/checkout.js + the
 * /ugc-2/claim and /ugc-2/welcome pair): after payment, the visitor
 * signs up with ANY email or Google account, the Stripe customer is
 * auto-linked, and they land back on /local-business — now subscribed
 * and ready to generate.
 *
 * surface="local-business" so the subscription shows up in Stripe as
 * the "Local Business Monthly/Pro/Yearly Plan" (per the PLAN_SURFACES
 * variants in lib/stripe.js).
 */

// Same Wistia demo set as /local-business — keeps the front face
// identical so the pricing page feels like the same product.
const LANDING_VIDEOS = [
  { id: '85rijpwaq2', aspect: 0.5625 },
  { id: 'lnndmek1c5', aspect: 0.5598755832037325 },
  { id: 'lsno8w6lt4', aspect: 0.5598755832037325 },
  { id: 'nx8bxwnoiw', aspect: 0.5581395348837209 },
];

export default function LocalBusinessPricingPlanPage() {
  const [error, setError] = useState('');
  const [entitlement, setEntitlement] = useState(null);

  // Best-effort entitlement fetch so Paywall can show the right cards
  // (anon + non-subscriber -> plan cards; subscriber -> top-ups).
  // Silent failure is fine; Paywall handles null entitlement.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/entitlement')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setEntitlement(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Head>
        <title>Local Business Plans — Ariya Lab</title>
      </Head>
      <main className={styles.page} style={{ paddingTop: 8 }}>
        <div className={styles.hero} style={{ marginBottom: 6, textAlign: 'center' }}>
          <h1
            className={styles.headline}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(26px, 4vw, 44px)',
              fontWeight: 400,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              color: 'var(--text)',
              margin: '0 auto 0',
              maxWidth: '88%',
            }}
          >
            Keep your local business{' '}
            <em className="shimmer-text" style={{ fontStyle: 'italic' }}>visible</em>
            {' '}— without the time, the camera, or big budget
          </h1>
          <p
            style={{
              margin: '10px auto 0',
              maxWidth: 520,
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--text-dim)',
              textAlign: 'center',
            }}
          >
            Type what you want or upload a photo, and Ariya Lab builds a
            ready-to-post video in minutes.
          </p>
        </div>

        {/* Demo reel — placed under the subheadline so the visitor
            sees the product first, then the pricing cards. Compact
            sizing per UX intent (don't hog vertical space above the
            paywall). */}
        <Script src="https://fast.wistia.com/player.js" strategy="afterInteractive" async />
        {LANDING_VIDEOS.map((v) => (
          <Script
            key={v.id}
            src={`https://fast.wistia.com/embed/${v.id}.js`}
            strategy="afterInteractive"
            type="module"
            async
          />
        ))}
        <div className="lb-pricing-carousel-wrap">
          <div className="lb-pricing-carousel" role="region" aria-label="Examples">
            {LANDING_VIDEOS.map((v) => (
              <div key={v.id} className="lb-pricing-carousel-card">
                <wistia-player
                  media-id={v.id}
                  aspect={String(v.aspect)}
                  autoplay="true"
                  muted="true"
                  silentautoplay="true"
                  playsinline="true"
                  controls-visible-on-load="false"
                  playbar="false"
                  playbutton="false"
                  volume-control="false"
                  fullscreen-button="false"
                  settings-control="false"
                  endvideobehavior="loop"
                />
              </div>
            ))}
          </div>
        </div>

        <Paywall
          entitlement={entitlement}
          returnTo="/local-business/pricing-plan"
          surface="local-business"
          onError={(msg) => setError(msg)}
        />
        {error && (
          <div className={styles.error} style={{ maxWidth: 560, margin: '12px auto' }}>
            {error}
          </div>
        )}

        <style jsx global>{`
          .lb-pricing-carousel-wrap { max-width: 100%; margin: 10px auto 4px; padding: 0; }
          .lb-pricing-carousel {
            display: flex;
            gap: 10px;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            scroll-padding: 0 12px;
            padding: 4px 12px 10px;
            scrollbar-width: none;
          }
          .lb-pricing-carousel::-webkit-scrollbar { display: none; }
          .lb-pricing-carousel-card {
            flex: 0 0 auto;
            width: clamp(78px, 22vw, 100px);
            border-radius: 14px;
            overflow: hidden;
            position: relative;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: radial-gradient(130% 70% at 50% -10%, rgba(255,255,255,0.06), transparent 56%), rgba(10,10,12,0.5);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 16px 48px -16px rgba(0,0,0,0.8), 0 4px 18px rgba(0,0,0,0.45);
            backdrop-filter: blur(12px) saturate(130%);
            -webkit-backdrop-filter: blur(12px) saturate(130%);
            scroll-snap-align: center;
            min-width: 0;
            transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease;
          }
          .lb-pricing-carousel-card:hover {
            transform: translateY(-2px);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.13), 0 24px 60px -20px rgba(0,0,0,0.9), 0 8px 24px rgba(0,0,0,0.5);
          }
          .lb-pricing-carousel-card wistia-player { display: block; width: 100%; max-width: 100%; }
          @media (min-width: 720px) {
            .lb-pricing-carousel { justify-content: center; scroll-padding: 0; padding: 4px 20px 10px; }
            .lb-pricing-carousel-card { width: 92px; }
          }
        `}</style>
      </main>
    </>
  );
}
