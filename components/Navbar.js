import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

import styles from './Navbar.module.css';
import { getBrowserSupabase } from '../lib/supabase';

export default function Navbar({ activeTab, onTabChange }) {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const supabase = getBrowserSupabase();

    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  const handleSignOut = async () => {
    setMenuOpen(false);
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">F</div>
          <span className={styles.wordmark}>FaceForge</span>
        </Link>

        {user && router.pathname === '/' && (
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'create'}
              className={`${styles.tab} ${activeTab === 'create' ? styles.tabActive : ''}`}
              onClick={() => onTabChange('create')}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              className={`${styles.tab} ${activeTab === 'history' ? styles.tabActive : ''}`}
              onClick={() => onTabChange('history')}
            >
              History
            </button>
          </div>
        )}

        <div className={styles.status}>
          {user ? (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#ddd',
                  padding: '6px 12px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'inherit',
                }}
              >
                {user.email?.split('@')[0] || 'Account'} \u25be
              </button>
              {menuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '110%',
                    right: 0,
                    background: '#0f0f11',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 8,
                    padding: 6,
                    minWidth: 180,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                    zIndex: 9000,
                  }}
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <Link
                    href="/dashboard"
                    style={{
                      display: 'block',
                      padding: '8px 10px',
                      color: '#ddd',
                      textDecoration: 'none',
                      fontSize: 13,
                      borderRadius: 4,
                    }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Dashboard
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      color: '#ddd',
                      background: 'transparent',
                      border: 'none',
                      fontSize: 13,
                      cursor: 'pointer',
                      borderRadius: 4,
                      fontFamily: 'inherit',
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/sign-in"
              style={{
                color: '#e0c488',
                fontSize: 12,
                textDecoration: 'none',
                letterSpacing: '0.04em',
                border: '1px solid rgba(224, 196, 136, 0.4)',
                padding: '6px 12px',
                borderRadius: 6,
              }}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
