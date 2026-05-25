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
              fontSize: 'clamp(18px, 2.6vw, 26px)',
              margin: '4px auto',
              lineHeight: 1.2,
              display: 'inline-block',
              padding: '6px 14px',
              borderRadius: 10,
              border: '1px solid rgba(224, 196, 136, 0.4)',
              background: 'rgba(224, 196, 136, 0.08)',
              color: '#f5ebd0',
              maxWidth: '94%',
            }}
          >
            Keep your local business visible — without the time, the camera, or big budget
          </h1>
          <p
            style={{
              margin: '8px auto 0',
              maxWidth: 560,
              fontSize: 14,
              lineHeight: 1.5,
              color: '#cfcfcf',
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
          .lb-pricing-carousel-wrap { max-width: 100%; margin: 10px auto 6px; padding: 0; }
          .lb-pricing-carousel {
            display: flex;
            gap: 10px;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            scroll-padding: 0 16px;
            padding: 4px 16px 10px;
            scrollbar-width: none;
          }
          .lb-pricing-carousel::-webkit-scrollbar { display: none; }
          .lb-pricing-carousel-card {
            flex: 0 0 auto;
            width: clamp(100px, 30vw, 130px);
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid rgba(224, 196, 136, 0.18);
            background: #0c0c0e;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
            scroll-snap-align: center;
            min-width: 0;
          }
          .lb-pricing-carousel-card wistia-player { display: block; width: 100%; max-width: 100%; }
          @media (min-width: 720px) {
            .lb-pricing-carousel { justify-content: center; scroll-padding: 0; padding: 4px 24px 10px; }
            .lb-pricing-carousel-card { width: 120px; }
          }
        `}</style>
      </main>
    </>
  );
}
