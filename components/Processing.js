import { useEffect, useRef, useState } from 'react';

import styles from './Processing.module.css';
import { log } from '../lib/debugLog';

/*
 * Generation progress UI. Polls /api/status?predictionId=… and shows:
 *   - a phase label driven by the real Replicate status + elapsed time
 *   - a progress ring estimated from elapsed time relative to expected
 *     duration (kind === 'image' is fast, 'video' is slow)
 *   - a yellow "you can leave this page" callout, because Replicate
 *     keeps running on the server and the predictionId is persisted
 *     in localStorage so the next mount re-attaches.
 *
 * Props:
 *   predictionId   string                 (required)
 *   onComplete     (data) => void         called once on success
 *   onError        (msg)  => void         called once on error
 *   kind           'video' | 'image'      drives phase copy + ETA
 *   startedAt      number (ms epoch)      optional override for elapsed
 */

const VIDEO_PHASES = [
  { label: 'Sending to render machines', detail: 'Queueing your job on our GPU cluster.' },
  { label: 'Reading the source motion', detail: 'Analyzing every frame of your reference clip.' },
  { label: 'Painting your character in', detail: 'Generating new frames at high resolution.' },
  { label: 'Animating each frame', detail: 'Maintaining identity and lighting across the clip.' },
  { label: 'Polishing & encoding', detail: 'Color-matching and packaging your video.' },
];

const IMAGE_PHASES = [
  { label: 'Sending to the image model', detail: 'Queueing your character on our GPU.' },
  { label: 'Composing your character', detail: 'Blending faces, lighting, and scene.' },
  { label: 'Refining details', detail: 'Sharpening facial features and color.' },
];

// Expected wall-clock for each kind. Used purely for the progress
// estimate — the real status from Replicate decides when we hit 100%.
const EXPECTED_MS = {
  video: 4 * 60 * 1000, // 4 minutes
  image: 60 * 1000,     // 1 minute
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export default function Processing({
  predictionId,
  onComplete,
  onError,
  kind = 'video',
  startedAt,
  vendor = 'replicate',
}) {
  const phases = kind === 'image' ? IMAGE_PHASES : VIDEO_PHASES;
  const expected = EXPECTED_MS[kind] || EXPECTED_MS.video;

  const [progress, setProgress] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [statusLabel, setStatusLabel] = useState('queued');
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(startedAt || Date.now());
  const doneRef = useRef(false);

  useEffect(() => {
    if (!predictionId) return undefined;
    startRef.current = startedAt || Date.now();
    doneRef.current = false;

    const tick = setInterval(() => {
      if (doneRef.current) return;
      const e = Date.now() - startRef.current;
      setElapsed(e);

      // Estimate progress from elapsed time. Asymptote at ~92% so the
      // bar doesn't sit at 100% before Replicate confirms completion.
      const pct = Math.min(92, (e / expected) * 92);
      setProgress(pct);

      // Phase advances proportionally with elapsed time, capped at the
      // last index. Real Replicate status overrides this to "complete"
      // when it lands.
      const idx = Math.min(
        phases.length - 1,
        Math.floor((e / expected) * phases.length)
      );
      setPhaseIdx(idx);
    }, 500);

    let pollCount = 0;
    log('info', 'polling start', { predictionId, kind });

    const poll = setInterval(async () => {
      pollCount += 1;
      try {
        const res = await fetch(
          `/api/status?predictionId=${encodeURIComponent(predictionId)}&vendor=${encodeURIComponent(vendor)}`
        );
        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          log('error', `poll #${pollCount} not JSON`, {
            httpStatus: res.status,
            bodyPreview: text.slice(0, 300),
          });
          return;
        }
        log(res.ok ? 'info' : 'warn', `poll #${pollCount}`, {
          httpStatus: res.status,
          data,
        });

        if (data.status) setStatusLabel(data.status);

        if (data.status === 'complete') {
          doneRef.current = true;
          setProgress(100);
          setPhaseIdx(phases.length - 1);
          clearInterval(tick);
          clearInterval(poll);
          onComplete && onComplete(data);
        } else if (data.status === 'error') {
          doneRef.current = true;
          clearInterval(tick);
          clearInterval(poll);
          onError && onError(data.error || 'Generation failed.');
        }
      } catch (err) {
        log('error', `poll #${pollCount} threw`, { message: err.message });
      }
    }, kind === 'image' ? 2500 : 4000);

    return () => {
      doneRef.current = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [predictionId, onComplete, onError, kind, phases.length, expected, startedAt]);

  const currentPhase = phases[Math.min(phaseIdx, phases.length - 1)];
  const dashOffset = CIRCUMFERENCE - (CIRCUMFERENCE * progress) / 100;
  const expectedLabel = kind === 'image' ? 'up to a minute' : '2–4 minutes';
  const isQueued = statusLabel === 'queued' && progress < 5;

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <div
          className={styles.ringWrap}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
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

        <div className={styles.phase}>
          {isQueued ? 'Waiting in the GPU queue' : currentPhase.label}
        </div>
        <div className={styles.detail}>
          {isQueued
            ? 'Your job has been accepted and is waiting for a free GPU. This usually takes 10–60 seconds.'
            : currentPhase.detail}
        </div>

        <div className={styles.dots} aria-hidden="true">
          {phases.map((_, i) => (
            <span
              key={i}
              className={`${styles.dot} ${i <= phaseIdx ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <div className={styles.elapsed} aria-label="Elapsed time">
          Elapsed {formatElapsed(elapsed)}
        </div>

        <div className={styles.comeback} role="status">
          ✨ <strong>You can leave this page or close the app.</strong>{' '}
          Generation continues on our servers and will be ready when you come
          back. This usually takes <strong>{expectedLabel}</strong>.
        </div>
      </div>
    </section>
  );
}
