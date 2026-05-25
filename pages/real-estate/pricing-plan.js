import Head from 'next/head';
import { useEffect, useState } from 'react';

import styles from '../../styles/Home.module.css';
import Paywall from '../../components/Paywall';

/*
 * /real-estate/pricing-plan — pay-first landing for the Real Estate
 * funnel.
 *
 * Same headline + subheadline as /real-estate, but the page is the
 * PAYWALL — no creator form and no demo gallery. Clicking Subscribe
 * runs the leak-protected ticket flow (see pages/api/checkout.js + the
 * /ugc-2/claim and /ugc-2/welcome pair): after payment, the visitor
 * signs up with ANY email or Google account, the Stripe customer is
 * auto-linked, and they land back on /real-estate — now subscribed and
 * ready to generate.
 *
 * surface="real-estate" so the subscription shows up in Stripe as
 * the "Real Estate Monthly/Pro/Yearly Plan" (per the PLAN_SURFACES
 * variants in lib/stripe.js).
 */
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
      </main>
    </>
  );
}
