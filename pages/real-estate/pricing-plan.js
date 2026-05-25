import Head from 'next/head';
import Script from 'next/script';
import { useEffect, useState } from 'react';

import styles from '../../styles/Home.module.css';
import Paywall from '../../components/Paywall';

/*
 * /real-estate/pricing-plan — pay-first landing for the Real Estate
 * funnel.
 *
 * Same headline, subheadline, and demo reel as /real-estate, but the
 * page is the PAYWALL — no creator form. Clicking Subscribe runs the
 * leak-protected ticket flow (see pages/api/checkout.js + the
 * /ugc-2/claim and /ugc-2/welcome pair): after payment, the visitor
 * signs up with ANY email or Google account, the Stripe customer is
 * auto-linked, and they land back on /real-estate — now subscribed and
 * ready to generate.
 *
 * surface="real-estate" so the subscription shows up in Stripe as
 * the "Real Estate Monthly/Pro/Yearly Plan" (per the PLAN_SURFACES
 * variants in lib/stripe.js).
 */

// Same Wistia demo set as /real-estate — keeps the front face
// identical so the pricing page feels like the same product.
const LANDING_VIDEOS = [
  { id: '85rijpwaq2', aspect: 0.5625 },
  { id: 'lnndmek1c5', aspect: 0.5598755832037325 },
  { id: 'lsno8w6lt4', aspect: 0.5598755832037325 },
  { id: 'nx8bxwnoiw', aspect: 0.5581395348837209 },
];

export default function RealEstatePricingPlanPage() {
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
        <title>Real Estate Plans — Ariya Lab</title>
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
            Real estate agents: keep your social media active — without getting on camera
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
            Type what you want to announce — a new listing, an open house, a
            market update — and Ariya Lab builds the video in minutes. Your
            social presence, handled.
          </p>
        </div>

        <Paywall
          entitlement={entitlement}
          returnTo="/real-estate/pricing-plan"
          surface="real-estate"
          onError={(msg) => setError(msg)}
        />
        {error && (
          <div className={styles.error} style={{ maxWidth: 560, margin: '12px auto' }}>
            {error}
          </div>
        )}

        {/* Demo reel — same as /real-estate so the funnel feels
            continuous after a visitor clicks through from the creator
            page or from an ad. */}
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
        <div className="re-pricing-carousel-wrap">
          <div className="re-pricing-carousel" role="region" aria-label="Examples">
            {LANDING_VIDEOS.map((v) => (
              <div key={v.id} className="re-pricing-carousel-card">
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

        <style jsx global>{`
          .re-pricing-carousel-wrap { max-width: 100%; margin: 18px auto 8px; padding: 0; }
          .re-pricing-carousel {
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
          .re-pricing-carousel::-webkit-scrollbar { display: none; }
          .re-pricing-carousel-card {
            flex: 0 0 auto;
            width: clamp(140px, 42vw, 170px);
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid rgba(224, 196, 136, 0.18);
            background: #0c0c0e;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
            scroll-snap-align: center;
            min-width: 0;
          }
          .re-pricing-carousel-card wistia-player { display: block; width: 100%; max-width: 100%; }
          @media (min-width: 720px) {
            .re-pricing-carousel { justify-content: center; scroll-padding: 0; padding: 4px 24px 10px; }
            .re-pricing-carousel-card { width: 160px; }
          }
        `}</style>
      </main>
    </>
  );
}
