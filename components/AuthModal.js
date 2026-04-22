import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

import styles from './AuthModal.module.css';
import { getBrowserSupabase } from '../lib/supabase';

export default function AuthModal({ open, onClose, initialMode = 'signup', redirectTo = '/' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'google' | 'email' | null
  const [error, setError] = useState('');
  const router = useRouter();
  const googleBtnRef = useRef(null);

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!open || !googleClientId) return undefined;

    let cancelled = false;
    let pollId;

    const handleCredential = async (response) => {
      if (!response?.credential) return;
      setBusy('google');
      setError('');
      try {
        const supabase = getBrowserSupabase();
        if (!supabase) throw new Error('Auth not configured. Contact support.');
        const { error: err } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.credential,
        });
        if (err) throw err;
        // Fire-and-forget IP record so the trial gate has data on file.
        fetch('/api/signup-ip', { method: 'POST' }).catch(() => {});
        if (typeof onClose === 'function') onClose();
        router.push(redirectTo);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Google sign-in failed.');
          setBusy(null);
        }
      }
    };

    const tryInit = () => {
      const google = typeof window !== 'undefined' ? window.google : null;
      const container = googleBtnRef.current;
      if (!google?.accounts?.id || !container) return false;
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleCredential,
        ux_mode: 'popup',
      });
      container.textContent = '';
      google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: mode === 'signup' ? 'signup_with' : 'signin_with',
        shape: 'pill',
        width: 320,
      });
      return true;
    };

    if (!tryInit()) {
      pollId = setInterval(() => {
        if (tryInit()) clearInterval(pollId);
      }, 200);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [open, mode, googleClientId, router, onClose, redirectTo]);

  if (!open) return null;

  const emailCallbackUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`
      : undefined;

  const handleEmail = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy('email');
    setError('');
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error('Auth not configured. Contact support.');
      if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: emailCallbackUrl },
        });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      fetch('/api/signup-ip', { method: 'POST' }).catch(() => {});
      if (typeof onClose === 'function') onClose();
      router.push(redirectTo);
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <header className={styles.header}>
          <span className={styles.kicker}>◆ {mode === 'signup' ? 'Create account' : 'Welcome back'}</span>
          <h2 id="auth-modal-title" className={styles.title}>
            {mode === 'signup' ? 'Sign up to continue' : 'Sign in to continue'}
          </h2>
          <p className={styles.subtitle}>
            {mode === 'signup'
              ? 'Takes 15 seconds. Your uploaded files stay loaded on this page.'
              : 'Welcome back. Sign in and pick up where you left off.'}
          </p>
        </header>

        {googleClientId ? (
          <div
            ref={googleBtnRef}
            style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}
          />
        ) : (
          <div className={styles.error}>
            Google sign-in unavailable — NEXT_PUBLIC_GOOGLE_CLIENT_ID not set.
          </div>
        )}

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <form className={styles.form} onSubmit={handleEmail}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              className={styles.input}
            />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" className={styles.submitBtn} disabled={busy !== null}>
            {busy === 'email'
              ? 'Working…'
              : mode === 'signup'
              ? 'Create account'
              : 'Sign in'}
          </button>
        </form>

        <footer className={styles.footer}>
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button type="button" className={styles.link} onClick={() => setMode('signin')}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button type="button" className={styles.link} onClick={() => setMode('signup')}>
                Create an account
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
