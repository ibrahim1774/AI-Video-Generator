import { useEffect, useRef } from 'react';

import styles from './Result.module.css';
import { downloadVideo } from '../lib/downloadResult';

export default function Result({ job, onNewSwap }) {
  const resultUrl = job && job.resultUrl;
  const videoName = (job && job.videoFileName) || 'source.mp4';
  const faceName = (job && job.faceFileName) || 'face.jpg';
  const downloadName = (job && job.downloadName) || 'ariyalab.mp4';
  const downloadedRef = useRef(false);

  useEffect(() => {
    if (!resultUrl || downloadedRef.current) return;
    downloadedRef.current = true;
    downloadVideo(resultUrl, downloadName);
  }, [resultUrl, downloadName]);

  return (
    <section className={styles.wrap}>
      <div className={styles.badge}>
        <span className={styles.badgeDot} aria-hidden="true" />
        Done — saved to your device
      </div>

      <h2 className={styles.title}>
        Your video is <em>ready</em>
      </h2>

      <div className={styles.player}>
        {resultUrl ? (
          <video
            src={resultUrl}
            controls
            playsInline
            preload="metadata"
            className={styles.video}
          />
        ) : (
          <div className={styles.placeholder} aria-hidden="true">
            <div className={styles.playIcon}>▶</div>
          </div>
        )}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Source</span>
          <span className={styles.statValue}>{videoName}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Face</span>
          <span className={styles.statValue}>{faceName}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Status</span>
          <span className={`${styles.statValue} ${styles.statusOk}`}>Saved</span>
        </div>
      </div>

      <div className={styles.actions}>
        <a
          className={`${styles.btn} ${styles.btnPrimary}`}
          href={resultUrl || '#'}
          download={downloadName}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!resultUrl}
          onClick={(e) => {
            if (!resultUrl) e.preventDefault();
          }}
        >
          ↓ Download again
        </a>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onNewSwap}
        >
          + New
        </button>
      </div>
    </section>
  );
}
