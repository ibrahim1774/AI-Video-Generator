import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../../styles/Home.module.css';
import { getBrowserSupabase } from '../../lib/supabase';

const DEFAULT_ADMIN_EMAILS = ['ibrahim3709@gmail.com'];

function isAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowlist = list.length ? list : DEFAULT_ADMIN_EMAILS;
  return allowlist.map((s) => s.toLowerCase()).includes((email || '').toLowerCase());
}

export default function AdminPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [email, setEmail] = useState('');
  const [credits, setCredits] = useState(12);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setAuthLoaded(true);
      return undefined;
    }
    supabase.auth.getUser().then(({ data }) => {
      setAuthUser(data?.user || null);
      setAuthLoaded(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, sess) => {
      setAuthUser(sess?.user || null);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (authLoaded && !authUser) router.replace('/sign-in');
  }, [authLoaded, authUser, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch('/api/admin/grant-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), credits: Number(credits) }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(`${data.error}${data.code ? ` (${data.code})` : ''}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <p className={styles.subtitle}>Loading…</p>
        </div>
      </main>
    );
  }

  const callerIsAdmin = isAdminEmail(authUser.email);

  return (
    <>
      <Head>
        <title>Admin — Haelabs</title>
      </Head>
      <main className={styles.page} style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ Admin</span>
          <h1 className={styles.headline}>Grant credits</h1>
          <p className={styles.subtitle}>
            Add credits to any user's account by email. Server-side guard re-checks the
            admin allowlist regardless of what this UI shows.
          </p>
        </div>

        {!callerIsAdmin && (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid rgba(232,164,164,0.3)',
              background: 'rgba(232,164,164,0.08)',
              color: '#e8a4a4',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            You're signed in as <strong>{authUser.email}</strong>. The server will reject any grant
            attempt unless this email is in <code>ADMIN_EMAILS</code>.
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 24,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              User email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 9999,
                padding: '10px 16px',
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'inherit',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Credits to add
            </span>
            <input
              type="number"
              required
              min={1}
              max={10000}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 9999,
                padding: '10px 16px',
                color: 'var(--text)',
                fontSize: 14,
                fontFamily: 'inherit',
                maxWidth: 200,
              }}
            />
          </label>

          <button
            type="submit"
            disabled={busy || !email.trim()}
            style={{
              alignSelf: 'flex-start',
              background: 'var(--gold)',
              color: '#000',
              border: 'none',
              borderRadius: 9999,
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Granting…' : `Grant ${credits} credit${Number(credits) === 1 ? '' : 's'}`}
          </button>
        </form>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 10,
              border: '1px solid rgba(232,164,164,0.3)',
              background: 'rgba(232,164,164,0.08)',
              color: '#e8a4a4',
              fontSize: 13,
            }}
          >
            <strong>Failed:</strong> {error}
          </div>
        )}

        {result && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 10,
              border: '1px solid rgba(216,216,216,0.3)',
              background: 'rgba(255,255,255,0.04)',
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <div>✓ Granted <strong>{result.added}</strong> credits to <strong>{result.email}</strong></div>
            <div>Before: <strong>{result.beforeCredits}</strong> → After: <strong>{result.afterCredits}</strong></div>
            <div style={{ opacity: 0.6, marginTop: 8 }}>customer: {result.customerId}</div>
            <div style={{ opacity: 0.6 }}>supabase user: {result.supabaseUserId}</div>
          </div>
        )}
      </main>
    </>
  );
}
