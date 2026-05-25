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

// Same-origin, same-app path? Used to validate ?r=… before we trust it
// as a redirect target. Always falsy for absolute / protocol / //-prefix.
function safePath(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : null;
}

export async function getServerSideProps({ query, res }) {
  const sid = typeof query.session_id === 'string' ? query.session_id : null;
  const ret = safePath(query.r);
  // Where to bail to if anything fails. Honor `r` so a Local Business
  // payer who errors out lands on /local-business, not /ugc-2.
  const bailTarget = ret || '/ugc-2';
  const bail = (qs = '') => ({
    redirect: { destination: `${bailTarget}${qs}`, permanent: false },
  });

  if (!sid || !sid.startsWith('cs_')) return bail();

  try {
    const cs = await stripe().checkout.sessions.retrieve(sid);
    const paid =
      cs.payment_status === 'paid' || cs.payment_status === 'no_payment_required';
    if (!paid) return bail('?status=unpaid');

    res.setHeader(
      'Set-Cookie',
      `${CLAIM_COOKIE}=${sid}; Path=/; Max-Age=${TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    );
    // `r` rides as a query param to /ugc-2/welcome. It is NOT the
    // session ticket (which stays in the httpOnly cookie) — just the
    // post-signup destination, which is not secret.
    const welcomeQs = ret ? `?r=${encodeURIComponent(ret)}` : '';
    return {
      redirect: { destination: `/ugc-2/welcome${welcomeQs}`, permanent: false },
    };
  } catch {
    return bail('?status=error');
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
