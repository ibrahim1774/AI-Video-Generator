import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../../styles/Home.module.css';
import Paywall from '../../components/Paywall';
import { getBrowserSupabase } from '../../lib/supabase';

/*
 * UGC-2 landing — public, pay-first subscription flow.
 *
 * Anonymous visitor → click Subscribe → /api/checkout (anonymous
 * subscription path) → Stripe Checkout → success URL is
 *   /sign-up?session_id={CHECKOUT_SESSION_ID}&returnTo=/ugc-2/app
 * → /sign-up runs the existing claim flow (verifies email match via
 * /api/checkout/claim, links the Stripe customer to the new Supabase
 * user, seeds credits) → AuthModal redirects to /ugc-2/app on success.
 *
 * Existing tabs (/, /ugc, /dashboard, ...) are unaffected: this page
 * only reuses already-public components and endpoints.
 */
export default function Ugc2LandingPage() {
  const router = useRouter();
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setAuthLoaded(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data?.user) {
        setAuthLoaded(true);
        return;
      }
      // Already signed in — check entitlement. If they have an active
      // sub, skip the landing and send them straight to the app.
      try {
        const r = await fetch('/api/entitlement');
        const ent = await r.json().catch(() => null);
        if (cancelled) return;
        const isActive =
          ent &&
          (ent.tier === 'monthly' || ent.tier === 'yearly' || ent.tier === 'admin') &&
          (ent.status === 'active' || ent.status === 'trialing' || ent.status === 'admin');
        if (isActive) {
          router.replace('/ugc-2/app');
          return;
        }
      } catch {}
      setAuthLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <>
      <Head>
        <title>UGC-2 — Pay first, create instantly</title>
      </Head>
      <main className={styles.page} style={{ paddingTop: 24 }}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ UGC-2 · Members only</span>
          <h1 className={styles.headline}>
            Pay-first <span className={styles.accent}>UGC creator</span>
          </h1>
          <p className={styles.subtitle}>
            Subscribe, sign up, and start generating talking, moving videos
            from a single image. Cancel anytime.
          </p>
        </div>

        {authLoaded ? (
          <Paywall entitlement={null} returnTo="/ugc-2/app" />
        ) : (
          <div className={styles.hero}>
            <p className={styles.subtitle}>Loading…</p>
          </div>
        )}
      </main>
    </>
  );
}
