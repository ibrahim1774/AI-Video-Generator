import { useEffect, useRef, useState } from 'react';

import styles from './Processing.module.css';
import { log } from '../lib/debugLog';

const PHASES = [
  { label: 'Uploading assets', detail: 'Securing your character image and motion video.' },
  { label: 'Analyzing motion', detail: 'Extracting motion vectors from your reference clip.' },
  { label: 'Locking character', detail: 'Encoding your character\u2019s appearance.' },
  { label: 'Generating frames', detail: 'Rendering the new video frame-by-frame.' },
  { label: 'Post-processing', detail: 'Smoothing, color-matching and temporal blending.' },
  { label: 'Finalizing', detail: 'Encoding the final MP4 and preparing download.' },
];

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function Processing({ predictionId, onComplete, onError }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!predictionId) return undefined;

    const tick = setInterval(() => {
      setProgress((p) => {
        if (doneRef.current) return p;
        if (p >= 95) return p;
        const bump = 0.5 + Math.random() * 0.5;
        return Math.min(95, p + bump);
      });
      setPhase((current) => {
        if (doneRef.current) return current;
        const bucket = Math.min(PHASES.length - 1, Math.floor(Math.random() * PHASES.length));
        return bucket > current ? Math.min(PHASES.length - 1, current + 1) : current;
      });
    }, 200);

    let pollCount = 0;
    log('info', 'polling start', { predictionId });
    const poll = setInterval(async () => {
      pollCount += 1;
      try {
        const res = await fetch(`/api/status?predictionId=${encodeURIComponent(predictionId)}`);
        const rawText = await res.text();
        let data = {};
        try {
          data = rawText ? JSON.parse(rawText) : {};
        } catch (parseErr) {
          log('error', `poll #${pollCount} not JSON`, {
            httpStatus: res.status,
            bodyPreview: rawText.slice(0, 300),
          });
          return;
        }
        log(res.ok ? 'info' : 'warn', `poll #${pollCount}`, { httpStatus: res.status, data });
        if (!res.ok && !data.status) {
          throw new Error(data.error || 'Status lookup failed');
        }
        if (data.status === 'complete') {
          log('info', 'prediction complete', { resultUrl: data.resultUrl });
          doneRef.current = true;
          setProgress(100);
          setPhase(PHASES.length - 1);
          clearInterval(tick);
          clearInterval(poll);
          onComplete && onComplete(data);
        } else if (data.status === 'error') {
          log('error', 'prediction error', { error: data.error });
          doneRef.current = true;
          clearInterval(tick);
          clearInterval(poll);
          onError && onError(data.error || 'Face swap failed.');
        }
      } catch (err) {
        log('error', `poll #${pollCount} threw`, { message: err.message });
      }
    }, 3000);

    return () => {
      doneRef.current = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [predictionId, onComplete, onError]);

  const currentPhase = PHASES[Math.min(phase, PHASES.length - 1)];
  const dashOffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress) / 100;

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.ringWrap} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <svg width="140" height="140" viewBox="0 0 140 140" className={styles.ring}>
            <circle
              cx="70"
              cy="70"
              r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="3"
            />
            <circle
              cx="70"
              cy="70"
              r={RADIUS}
              fill="none"
              stroke="url(#ringGradient)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className={styles.ringStroke}
              transform="rotate(-90 70 70)"
            />
            <defs>
              <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#E0C488" />
                <stop offset="100%" stopColor="#8B7340" />
              </linearGradient>
            </defs>
          </svg>
          <div className={styles.percent}>{Math.round(progress)}%</div>
        </div>

        <div className={styles.phase}>{currentPhase.label}</div>
        <div className={styles.detail}>{currentPhase.detail}</div>

        <div className={styles.dots} aria-hidden="true">
          {PHASES.map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i <= phase ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <div className={styles.note}>
          This usually takes 20–60 seconds. Keep this tab open.
        </div>
      </div>
    </section>
  );
}
