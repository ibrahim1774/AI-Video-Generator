import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

import styles from '../../styles/History.module.css';
import { getBrowserSupabase } from '../../lib/supabase';
import { downloadVideo } from '../../lib/downloadResult';

const KIND_LABEL = {
  'face-swap': 'Face Swap',
  'image-to-video': 'Image → Video',
  ugc: 'UGC',
  'video-edit': 'Edit',
};

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function expiresIn(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h >= 1) return `expires in ${h}h`;
  const m = Math.max(1, Math.floor(ms / 60000));
  return `expires in ${m}m`;
}

export default function HistoryPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [items, setItems] = useState(null);
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
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (authLoaded && !authUser) router.replace('/sign-in');
  }, [authLoaded, authUser, router]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/history');
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(data.error || 'Could not load history.');
        setItems(data.items || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [authUser]);

  const handleDownload = (url, kind) => {
    downloadVideo(url, `ariyalab-${kind}-${Date.now()}.mp4`);
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>Loading…</div>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>History — Ariya Lab</title>
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>◆ Recent renders</div>
            <h1 className={styles.title}>History</h1>
          </div>
          <div className={styles.note}>Saved for 24 hours · then auto-deleted</div>
        </header>

        {error && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Something went wrong</div>
            <div className={styles.emptyBody}>{error}</div>
          </div>
        )}

        {!error && items && items.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>Nothing here yet</div>
            <div className={styles.emptyBody}>
              Your last 24 hours of renders will show up here. Make a face swap,
              UGC clip, or image-to-video and come back.
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link href="/" className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: '0 0 auto', padding: '10px 22px' }}>
                Start a face swap
              </Link>
            </div>
          </div>
        )}

        {!error && items && items.length > 0 && (
          <div className={styles.grid}>
            {items.map((item) => (
              <div key={item.id} className={styles.card}>
                <video
                  src={item.result_url}
                  className={styles.video}
                  preload="metadata"
                  playsInline
                  controls
                  muted
                />
                <div className={styles.cardBody}>
                  <div className={styles.row1}>
                    <span className={styles.kind}>{KIND_LABEL[item.kind] || item.kind}</span>
                    <span className={styles.time}>{relativeTime(item.created_at)}</span>
                  </div>
                  <div className={styles.time}>{expiresIn(item.expires_at)}</div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => handleDownload(item.result_url, item.kind)}
                    >
                      ↓ Download
                    </button>
                    <a
                      href={item.result_url}
                      target="_blank"
                      rel="noreferrer"
                      className={`${styles.btn} ${styles.btnGhost}`}
                    >
                      Open
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
