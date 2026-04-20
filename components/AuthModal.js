import { useState } from 'react';
import { useRouter } from 'next/router';

import styles from './AuthModal.module.css';
import { getBrowserSupabase } from '../lib/supabase';

/*
 * Signup/signin overlay that appears on the home page when an
 * anonymous user clicks "Create face swap". Wraps Supabase's
 * signInWithOAuth (Google, redirect) and signInWithPassword /
 * signUp (email/password).
 *
 * On successful auth, redirects the user to /dashboard.
 */
export default function AuthModal({ open, onClose, initialMode = 'signup' }) {
  const [mode, setMode] = useState(initialMode); // 'signup' | 'signin'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'google' | 'email' | null
  const [error, setError] = useState('');
  const router = useRouter();

  if (!open) return null;

  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : undefined;

  const handleGoogle = async () => {
    if (busy) return;
    setBusy('google');
    setError('');
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error('Auth not configured. Contact support.');
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (err) throw err;
      // Browser is redirecting to Google; no further action needed.
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setBusy(null);
    }
  };

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
          options: { emailRedirectTo: redirectTo },
        });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      router.push('/dashboard');
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
          \u00d7
        </button>
        <header className={styles.header}>
          <span className={styles.kicker}>\u25c6 {mode === 'signup' ? 'Create account' : 'Welcome back'}</span>
          <h2 id="auth-modal-title" className={styles.title}>
            {mode === 'signup' ? 'Sign up to continue' : 'Sign in to continue'}
          </h2>
          <p className={styles.subtitle}>
            {mode === 'signup'
              ? 'Takes 15 seconds. Your uploaded files stay loaded on this page.'
              : 'Welcome back. Sign in and pick up where you left off.'}
          </p>
        </header>

        <button
          type="button"
          className={styles.googleBtn}
          onClick={handleGoogle}
          disabled={busy !== null}
        >
          <span className={styles.googleIcon} aria-hidden="true">G</span>
          {busy === 'google'
            ? 'Redirecting\u2026'
            : mode === 'signup'
            ? 'Sign up with Google'
            : 'Sign in with Google'}
        </button>

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
              ? 'Working\u2026'
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
