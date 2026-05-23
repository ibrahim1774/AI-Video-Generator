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

  // Heal-topups (orphaned credit) panel state — separate so the two
  // tools don't clobber each other's UI.
  const [healEmail, setHealEmail] = useState('');
  const [healBusy, setHealBusy] = useState(false);
  const [healReport, setHealReport] = useState(null);
  const [healError, setHealError] = useState('');

  // Feature-tabs visibility toggle.
  const [tabsEnabled, setTabsEnabled] = useState(null); // null = loading

  useEffect(() => {
    fetch('/api/admin/feature-tabs')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setTabsEnabled(Boolean(d.enabled)))
      .catch(() => setTabsEnabled(false));
  }, []);

  const toggleTabs = async (next) => {
    setTabsEnabled(next); // optimistic
    try {
      const r = await fetch('/api/admin/feature-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to update.');
      setTabsEnabled(Boolean(d.enabled));
    } catch (e) {
      setTabsEnabled(!next); // revert
      setError(e.message);
    }
  };

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

  const callHeal = async (body) => {
    setHealBusy(true);
    setHealError('');
    try {
      const r = await fetch('/api/admin/heal-topups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok && r.status !== 409) {
        // 409 = ambiguous (multiple customers); we still want to show the report
        setHealError(`${data.error || 'Heal failed'}${data.code ? ` (${data.code})` : ''}`);
        setHealReport(null);
      } else {
        setHealReport(data);
      }
    } catch (err) {
      setHealError(err.message);
      setHealReport(null);
    } finally {
      setHealBusy(false);
    }
  };

  const handleHealCheck = (e) => {
    e.preventDefault();
    if (healBusy || !healEmail.trim()) return;
    callHeal({ email: healEmail.trim(), dryRun: true });
  };

  const handleHealApply = (customerId) => {
    if (healBusy) return;
    const body = { email: healEmail.trim(), dryRun: false };
    if (customerId) body.customerId = customerId;
    callHeal(body);
  };

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
        <title>Admin — Ariya Lab</title>
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

        <section
          style={{
            margin: '0 0 20px',
            padding: 20,
            borderRadius: 14,
            border: '1px solid rgba(224, 196, 136, 0.25)',
            background: 'rgba(224, 196, 136, 0.05)',
          }}
        >
          <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Feature tabs visibility</h3>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            When <strong>ON</strong>, all users see every tab. When <strong>OFF</strong>,
            non-admins only see the homepage (Image to Video) + Support. You always
            see everything.
          </p>
          <button
            type="button"
            disabled={tabsEnabled === null}
            onClick={() => toggleTabs(!tabsEnabled)}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.18)',
              background: tabsEnabled ? 'rgba(120, 220, 150, 0.14)' : 'rgba(255,255,255,0.04)',
              color: '#ededed',
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: tabsEnabled === null ? 'not-allowed' : 'pointer',
            }}
          >
            {tabsEnabled === null
              ? 'Loading…'
              : tabsEnabled
                ? 'Tabs are ON — click to turn OFF'
                : 'Tabs are OFF — click to turn ON'}
          </button>
        </section>

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

        {/* Fix orphaned top-ups */}
        <div style={{ marginTop: 32 }}>
          <div className={styles.hero} style={{ marginBottom: 12 }}>
            <span className={styles.eyebrow}>◆ Fix orphaned credits</span>
            <h2 className={styles.headline} style={{ fontSize: 'clamp(20px,3vw,28px)', margin: '8px 0 4px' }}>
              Customer paid but doesn't see credits?
            </h2>
            <p className={styles.subtitle} style={{ fontSize: 13 }}>
              Type the customer's email. The first click is a dry run that
              shows what we'd change — review, then click Relink.
            </p>
          </div>

          <form
            onSubmit={handleHealCheck}
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
                Customer email
              </span>
              <input
                type="email"
                required
                value={healEmail}
                onChange={(e) => { setHealEmail(e.target.value); setHealReport(null); setHealError(''); }}
                placeholder="customer@example.com"
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

            <button
              type="submit"
              disabled={healBusy || !healEmail.trim()}
              style={{
                alignSelf: 'flex-start',
                background: 'rgba(255,255,255,0.08)',
                color: 'var(--text)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 9999,
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 600,
                cursor: healBusy ? 'not-allowed' : 'pointer',
                opacity: healBusy ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              {healBusy ? 'Checking…' : 'Check status'}
            </button>
          </form>

          {healError && (
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
              <strong>Failed:</strong> {healError}
            </div>
          )}

          {healReport && (
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
              {/* Already linked correctly */}
              {healReport.ok && !healReport.dryRun && healReport.message?.includes('already linked') && (
                <div style={{ color: '#a8d8a8' }}>
                  ✓ Already linked correctly. No action needed.
                  <div style={{ opacity: 0.6, marginTop: 6 }}>customer: {healReport.targetCustomerId}</div>
                  <div style={{ opacity: 0.6 }}>credits available: {healReport.targetCustomer?.creditsRemaining ?? '—'}</div>
                </div>
              )}

              {/* Successfully relinked */}
              {healReport.ok && healReport.dryRun === false && healReport.previouslyLinked !== undefined && (
                <div style={{ color: '#a8d8a8' }}>
                  ✓ Relinked. Customer should now see <strong>{healReport.creditsVisibleToUser}</strong> credit{healReport.creditsVisibleToUser === 1 ? '' : 's'}.
                  <div style={{ opacity: 0.6, marginTop: 6 }}>was: {healReport.previouslyLinked || '(none)'}</div>
                  <div style={{ opacity: 0.6 }}>now: {healReport.nowLinked}</div>
                </div>
              )}

              {/* Dry-run preview, single candidate */}
              {healReport.dryRun === true && (
                <>
                  <div>Currently linked: <strong>{healReport.currentlyLinked || '(none)'}</strong></div>
                  <div>Would link to: <strong>{healReport.targetCustomerId}</strong></div>
                  <div>Credits on that customer: <strong>{healReport.targetCustomer?.creditsRemaining ?? '—'}</strong></div>
                  {healReport.otherCandidates?.length > 0 && (
                    <div style={{ marginTop: 8, opacity: 0.7 }}>
                      Other Stripe customers for this email (will be ignored):
                      <ul style={{ margin: '4px 0 0 16px' }}>
                        {healReport.otherCandidates.map((c) => (
                          <li key={c.id}>{c.id} — {c.creditsRemaining} cr</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleHealApply(null)}
                    disabled={healBusy}
                    style={{
                      marginTop: 12,
                      background: 'var(--gold)',
                      color: '#000',
                      border: 'none',
                      borderRadius: 9999,
                      padding: '10px 24px',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: healBusy ? 'not-allowed' : 'pointer',
                      opacity: healBusy ? 0.5 : 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    {healBusy ? 'Relinking…' : 'Relink customer'}
                  </button>
                </>
              )}

              {/* Ambiguous: multiple customers, must pick one */}
              {healReport.ambiguous && (
                <>
                  <div style={{ color: '#e8c879' }}>
                    ⚠ {healReport.message}
                  </div>
                  <div style={{ marginTop: 6 }}>Currently linked: <strong>{healReport.currentlyLinked || '(none)'}</strong></div>
                  <div style={{ marginTop: 8 }}>Pick which customer to link:</div>
                  <ul style={{ margin: '6px 0 0', listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {healReport.candidates.map((c) => (
                      <li key={c.id} style={{
                        padding: 12,
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}>
                        <span>
                          <strong>{c.id}</strong> — {c.creditsRemaining} cr
                          {c.id === healReport.suggestion && <span style={{ marginLeft: 8, opacity: 0.7 }}>(suggested)</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleHealApply(c.id)}
                          disabled={healBusy}
                          style={{
                            background: c.id === healReport.suggestion ? 'var(--gold)' : 'rgba(255,255,255,0.08)',
                            color: c.id === healReport.suggestion ? '#000' : 'var(--text)',
                            border: c.id === healReport.suggestion ? 'none' : '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 9999,
                            padding: '6px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: healBusy ? 'not-allowed' : 'pointer',
                            opacity: healBusy ? 0.5 : 1,
                            fontFamily: 'inherit',
                          }}
                        >
                          Link this one
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
