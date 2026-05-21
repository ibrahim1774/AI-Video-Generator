import Head from 'next/head';
import { useState } from 'react';

import AuthModal from '../../components/AuthModal';

/*
 * /ugc-2/welcome — sign-up step of the pay-first ticket flow.
 *
 * Reached only after /ugc-2/claim has verified payment and stashed the
 * Stripe session_id in an httpOnly cookie. The session_id is NOT in this
 * URL. getServerSideProps confirms the claim cookie exists; if it's
 * missing (opened directly, or the 30-min ticket expired) we send the
 * visitor back to /ugc-2 instead of letting them sign up and silently
 * fail to link.
 *
 * AuthModal runs in ticketClaim mode: no locked email, so the visitor
 * may sign up with ANY email or Google account. On success it POSTs to
 * /api/checkout/claim-ticket, which reads the cookie and binds the
 * Stripe customer to the new Supabase user. Then back to /ugc-2 — now
 * subscribed, so the creator form renders.
 */
export async function getServerSideProps({ req }) {
  const hasTicket = Boolean(req.cookies && req.cookies.ugc2_claim_sid);
  if (!hasTicket) {
    return { redirect: { destination: '/ugc-2', permanent: false } };
  }
  return { props: {} };
}

export default function Ugc2WelcomePage() {
  const [open] = useState(true);
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
          onClose={() => (window.location.href = '/ugc-2')}
          initialMode="signup"
          redirectTo="/ugc-2"
          ticketClaim
        />
      </main>
    </>
  );
}
