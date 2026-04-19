import { useEffect, useState } from 'react';

import styles from './JobHistory.module.css';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function statusClass(status) {
  switch (status) {
    case 'complete':
      return 'badgeOk';
    case 'error':
      return 'badgeErr';
    default:
      return 'badgeWait';
  }
}

export default function JobHistory() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        if (!cancelled) setJobs(data.jobs || []);
      } catch {
        // leave empty on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className={styles.wrap}>
      <header className={styles.head}>
        <h2 className={styles.title}>Job history</h2>
        <p className={styles.subtitle}>
          {loading
            ? 'Loading…'
            : jobs.length === 0
            ? 'Nothing yet'
            : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`}
        </p>
      </header>

      {jobs.length === 0 && !loading ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">◆</div>
          <div className={styles.emptyTitle}>No jobs yet</div>
          <div className={styles.emptyDetail}>
            Create your first face swap and it will appear here.
          </div>
        </div>
      ) : (
        <ul className={styles.list}>
          {jobs.map((job) => (
            <li key={job.jobId} className={styles.card}>
              <div className={styles.row}>
                <span className={styles.jobId}>{job.jobId.slice(0, 8)}</span>
                <span className={`${styles.badge} ${styles[statusClass(job.status)]}`}>
                  {job.status}
                </span>
              </div>
              <div className={styles.files}>
                <span className={styles.fileChip}>{job.videoFileName || 'source'}</span>
                <span className={styles.arrow} aria-hidden="true">→</span>
                <span className={styles.fileChip}>{job.faceFileName || 'face'}</span>
              </div>
              <div className={styles.meta}>
                <span className={styles.metaTime}>{timeAgo(job.createdAt)}</span>
                {job.resultUrl && (
                  <a
                    className={styles.download}
                    href={job.resultUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↓ Download
                  </a>
                )}
              </div>
              {job.error && <div className={styles.error}>{job.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
