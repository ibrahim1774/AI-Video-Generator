import Head from 'next/head';
import { useState } from 'react';
import { useRouter } from 'next/router';

import AuthModal from '../../components/AuthModal';

/*
 * /ugc-2/welcome — sign-up step of the pay-first ticket flow.
 *
 * Reached only after /ugc-2/claim has verified payment and stashed the
 * Stripe session_id in an httpOnly cookie. The session_id is NOT in this
 * URL. getServerSideProps confirms the claim cookie exists; if it's
 * missing (opened directly, or the 30-min ticket expired) we send the
 * visitor back to / instead of letting them sign up and silently fail
 * to link.
 *
 * AuthModal runs in ticketClaim mode: no locked email, so the visitor
 * may sign up with ANY email or Google account. On success it POSTs to
 * /api/checkout/claim-ticket, which reads the cookie and binds the
 * Stripe customer to the new Supabase user. Then back to the funnel
 * page they came from (via ?r=…; defaults to /ugc-2).
 */
function safePath(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null;
}

export async function getServerSideProps({ req, query }) {
  const hasTicket = Boolean(req.cookies && req.cookies.ugc2_claim_sid);
  const ret = safePath(query.r) || '/ugc-2';
  if (!hasTicket) {
    return { redirect: { destination: ret, permanent: false } };
  }
  return { props: {} };
}

export default function Ugc2WelcomePage() {
  const [open] = useState(true);
  const router = useRouter();
  // After signup, send the user back to whichever funnel they came
  // from (e.g. /local-business after a /local-business/pricing-plan
  // purchase). Falls back to /ugc-2 so existing UGC-2 traffic is
  // byte-for-byte unchanged.
  const redirectTo = safePath(router.query.r) || '/ugc-2';

  return (
    <>
      <Head>
        <title>Finish setup — Ariya Lab</title>
      </Head>
      <main
        style={{
          minHeight: '80vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        <AuthModal
          open={open}
          onClose={() => (window.location.href = redirectTo)}
          initialMode="signup"
          redirectTo={redirectTo}
          ticketClaim
        />
      </main>
    </>
  );
}
