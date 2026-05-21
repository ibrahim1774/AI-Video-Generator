import { stripe } from '../../lib/stripe';

/*
 * /ugc-2/claim — leak-protected hand-off after the pay-first checkout.
 *
 * Stripe redirects here with ?session_id=cs_... (the only place the
 * ticket ever rides in a URL). getServerSideProps runs server-side:
 *   1. verifies the session is actually paid,
 *   2. stows the session_id in an httpOnly cookie, and
 *   3. 302-redirects to /ugc-2/welcome — a CLEAN url with no ticket.
 *
 * Because the redirect happens before any HTML renders, the session_id
 * never reaches the client: the Meta/TikTok pixels (which mount on the
 * destination page) and document.referrer only ever see /ugc-2/welcome.
 *
 * Failure modes redirect back to /ugc-2 rather than dead-ending.
 */

const CLAIM_COOKIE = 'ugc2_claim_sid';
const TTL_SECONDS = 1800; // 30 minutes

export async function getServerSideProps({ query, res }) {
  const sid = typeof query.session_id === 'string' ? query.session_id : null;
  const bail = (destination) => ({ redirect: { destination, permanent: false } });

  if (!sid || !sid.startsWith('cs_')) return bail('/ugc-2');

  try {
    const cs = await stripe().checkout.sessions.retrieve(sid);
    const paid =
      cs.payment_status === 'paid' || cs.payment_status === 'no_payment_required';
    if (!paid) return bail('/ugc-2?status=unpaid');

    res.setHeader(
      'Set-Cookie',
      `${CLAIM_COOKIE}=${sid}; Path=/; Max-Age=${TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    );
    return { redirect: { destination: '/ugc-2/welcome', permanent: false } };
  } catch {
    return bail('/ugc-2?status=error');
  }
}

// Rendered only in the brief moment before the redirect resolves.
export default function Ugc2ClaimRedirect() {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#bbb',
        fontFamily: 'inherit',
        fontSize: 14,
      }}
    >
      Finishing up…
    </main>
  );
}
