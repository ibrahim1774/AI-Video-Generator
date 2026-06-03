import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import Paywall from '../components/Paywall';
import DurationSlider, {
  costForDuration,
  snapToStandardPreset,
} from '../components/DurationSlider';
import ModelPicker from '../components/ModelPicker';
import ResolutionPicker from '../components/ResolutionPicker';
import { uploadTempFile } from '../lib/uploader';
import { getBrowserSupabase } from '../lib/supabase';
import { bumpEntitlement } from '../lib/entitlementBus';
import { saveJob, loadJob, clearJob } from '../lib/jobPersist';
import { maybeCompressImage } from '../lib/imageCompress';

const FEATURE = 'image-to-video';

export default function ImageToVideoPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [step, setStep] = useState('upload'); // 'upload' | 'paywall' | 'processing' | 'result'
  const [imageFile, setImageFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('standard');
  const [resolution, setResolution] = useState('480p');
  const [duration, setDuration] = useState(4);
  const [audio, setAudio] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [entitlement, setEntitlement] = useState(null);

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

  // Resume any in-flight job from localStorage so the user can leave
  // the page mid-generation and come back to the same state.
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const saved = loadJob(FEATURE);
    if (saved && saved.predictionId) {
      setJob({
        predictionId: saved.predictionId,
        downloadName: saved.downloadName || 'image-to-video.mp4',
        startedAt: saved.startedAt,
        vendor: saved.vendor || 'replicate',
      });
      setStep('processing');
    }
  }, [authLoaded, authUser]);

  const fetchEntitlement = useCallback(async () => {
    try {
      const res = await fetch('/api/entitlement');
      const data = await res.json();
      setEntitlement(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (authUser) fetchEntitlement();
  }, [authUser, fetchEntitlement]);

  const canSubmit = Boolean(imageFile && !submitting);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const compressed = await maybeCompressImage(imageFile);
      const imageUrl = await uploadTempFile(compressed);
      const res = await fetch('/api/image-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, prompt, model, resolution, duration, audio }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to start.');
      const startedAt = Date.now();
      const newJob = {
        predictionId: data.predictionId,
        downloadName: 'image-to-video.mp4',
        startedAt,
        vendor: 'kie',
      };
      saveJob(FEATURE, { ...newJob, kind: 'image-to-video' });
      setJob(newJob);
      bumpEntitlement();
      setStep('processing');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    clearJob(FEATURE);
    setStep('upload');
    setImageFile(null);
    setPrompt('');
    setJob(null);
    setError('');
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <p className={`${styles.subtitle} shimmer-text`} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Loading…</p>
        </div>
      </main>
    );
  }

  if (step === 'processing' && job) {
    return (
      <main className={styles.page}>
        <Processing
          predictionId={job.predictionId}
          startedAt={job.startedAt}
          vendor={job.vendor || 'kie'}
          kind="video"
          historyKind="image-to-video"
          onComplete={(data) => {
            clearJob(FEATURE);
            setJob((prev) => ({ ...prev, resultUrl: data.resultUrl }));
            setStep('result');
          }}
          onError={(msg) => {
            clearJob(FEATURE);
            setError(msg);
            setStep('upload');
          }}
        />
      </main>
    );
  }

  if (step === 'result' && job) {
    return (
      <main className={styles.page}>
        <Result job={{ ...job, videoFileName: imageFile?.name }} onNewSwap={reset} />
      </main>
    );
  }

  if (step === 'paywall') {
    return (
      <main className={styles.page}>
        <div className={`${styles.hero} fade-up`}>
          <span className={styles.eyebrow}>◆ Out of credits</span>
          <h1 className={styles.headline}>Pick a plan to <em className={styles.accent}>keep going</em></h1>
        </div>
        <Paywall
          entitlement={entitlement}
          returnTo="/image-to-video"
          onError={(msg) => setError(msg)}
          onTrialStarted={() => {
            fetchEntitlement();
            setStep('upload');
          }}
        />
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button
            type="button"
            onClick={() => setStep('upload')}
            className="btn-ghost"
            style={{ fontSize: 13 }}
          >
            ← Back
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Image to Video — Ariya Lab</title>
      </Head>
      <main className={styles.page}>
        {/* ── Hero ── */}
        <div className={`${styles.hero} fade-up`}>
          <span className={styles.eyebrow}>◆ Image to Video</span>
          <h1 className={styles.headline}>
            Turn a photo into a{' '}
            <em className={styles.accent}>moving clip</em>
          </h1>
          <p className={styles.subtitle}>
            Upload one image and describe the motion you want. Our top-rated
            video model paints it to life &mdash;{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>1 credit per generation</strong>.
          </p>
        </div>

        {/* ── Info banner ── */}
        <div
          className={styles.banner}
          style={{
            maxWidth: 720,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.07em',
            lineHeight: 1.6,
            color: 'var(--text-dim)',
          }}
        >
          ◆&nbsp; Powered by Kling 3.0 — pick any length from{' '}
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>3 to 15 seconds</strong>.
          &nbsp;Optional native audio (dialogue, lip-sync, sound effects).
          &nbsp;1 credit per 3 s of video.
          &nbsp;Generation takes{' '}
          <strong style={{ color: 'var(--text)', fontWeight: 600 }}>2–4 minutes</strong>.
        </div>

        {/* ── Main form card ── */}
        <form
          className={styles.shell}
          onSubmit={handleSubmit}
          style={{
            position: 'relative',
            background: [
              'radial-gradient(130% 70% at 50% -10%, rgba(255,255,255,0.06), transparent 56%)',
              'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))',
              'rgba(10,10,12,0.50)',
            ].join(', '),
            backdropFilter: 'blur(16px) saturate(130%)',
            WebkitBackdropFilter: 'blur(16px) saturate(130%)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 'var(--radius-2xl)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), var(--shadow-xl)',
            padding: '36px 36px 32px',
            gap: 24,
          }}
        >
          {/* specular top sheen */}
          <span
            aria-hidden="true"
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, transparent 40%)',
              zIndex: 0,
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>
            {/* Upload zone */}
            <div className={styles.uploads} style={{ gridTemplateColumns: '1fr' }}>
              <UploadZone
                label="Starting image"
                sublabel="JPG or PNG · clear subject, good lighting"
                icon="🖼️"
                accept="image/jpeg,image/png"
                file={imageFile}
                onFileSelected={setImageFile}
                onRemove={() => setImageFile(null)}
                maxSizeMB={1024}
              />
            </div>

            {/* Motion prompt */}
            <label style={{ display: 'block' }}>
              <span
                className={styles.swapModeLabel}
                style={{
                  display: 'block',
                  marginBottom: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                }}
              >
                Describe the motion
              </span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder='e.g. The woman smiles and turns to the camera. She says: "Hi, welcome back to my channel."'
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(4,4,6,0.7)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  resize: 'vertical',
                  outline: 'none',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.45)',
                  transition: 'border-color 0.2s var(--ease), box-shadow 0.2s var(--ease)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 8px rgba(0,0,0,0.45), 0 0 0 3px rgba(255,255,255,0.06)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'inset 0 2px 8px rgba(0,0,0,0.45)';
                }}
              />
            </label>

            <ModelPicker
              value={model}
              onChange={(next) => {
                setModel(next);
                if (next === 'standard') setDuration((d) => snapToStandardPreset(d));
              }}
            />
            <ResolutionPicker
              model={model}
              resolution={resolution}
              audio={audio}
              onChange={(next) => {
                setResolution(next.resolution);
                setAudio(next.audio);
              }}
            />
            <DurationSlider
              value={duration}
              onChange={setDuration}
              model={model}
              resolution={resolution}
              audio={audio}
            />

            {error && <div className={styles.error}>{error}</div>}

            {/* CTA */}
            <button
              type="submit"
              disabled={!canSubmit}
              className={submitting ? styles.submitLoading : ''}
              style={canSubmit && !submitting ? {
                width: '100%',
                padding: '17px 24px',
                borderRadius: 'var(--radius-lg)',
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '0.03em',
                background: 'linear-gradient(180deg, #ffffff 0%, #d4d4da 100%)',
                color: '#0a0a0b',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                boxShadow: [
                  'inset 0 1px 0 rgba(255,255,255,0.9)',
                  'inset 0 -1px 0 rgba(0,0,0,0.15)',
                  'var(--accent-glow)',
                  'var(--shadow-md)',
                ].join(', '),
                transition: 'transform 0.18s var(--ease-out-quint), box-shadow 0.25s var(--ease)',
              } : {
                width: '100%',
                padding: '17px 24px',
                borderRadius: 'var(--radius-lg)',
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '0.03em',
                background: submitting ? 'var(--surface-2)' : 'rgba(255,255,255,0.04)',
                color: submitting ? 'var(--text-dim)' : 'var(--text-faint)',
                border: '1px solid var(--border)',
                cursor: submitting ? 'progress' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                transition: 'transform 0.18s var(--ease-out-quint), box-shadow 0.25s var(--ease)',
              }}
              onMouseEnter={(e) => {
                if (canSubmit && !submitting) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = [
                    'inset 0 1px 0 rgba(255,255,255,0.9)',
                    'inset 0 -1px 0 rgba(0,0,0,0.15)',
                    'var(--accent-glow-strong)',
                    'var(--shadow-lg)',
                  ].join(', ');
                }
              }}
              onMouseLeave={(e) => {
                if (canSubmit && !submitting) {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = [
                    'inset 0 1px 0 rgba(255,255,255,0.9)',
                    'inset 0 -1px 0 rgba(0,0,0,0.15)',
                    'var(--accent-glow)',
                    'var(--shadow-md)',
                  ].join(', ');
                }
              }}
            >
              {submitting && <span className={styles.spinner} aria-hidden="true" />}
              {submitting
                ? 'Starting…'
                : (() => {
                  const c = costForDuration(duration, model, resolution, audio);
                  return `Generate (${c} credit${c === 1 ? '' : 's'})`;
                })()}
            </button>

            {entitlement && entitlement.canSwap && (
              <div
                className={styles.usage}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                }}
              >
                {entitlement.creditsRemaining} credit
                {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
              </div>
            )}
          </div>
        </form>
      </main>
    </>
  );
}
