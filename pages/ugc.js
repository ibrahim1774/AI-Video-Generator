import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import Paywall from '../components/Paywall';
import { uploadTempFile } from '../lib/uploader';
import { getBrowserSupabase } from '../lib/supabase';
import { bumpEntitlement } from '../lib/entitlementBus';

function costForDuration(d) {
  return Math.ceil(d / 3);
}

export default function UgcPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // 'choose' = pick image; 'animate' = script + slider; 'processing' | 'result' | 'paywall'
  const [step, setStep] = useState('choose');
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(null); // 'upload' | 'generate' | null
  const [imagePrompt, setImagePrompt] = useState('');
  const [uploadFile, setUploadFile] = useState(null);

  const [script, setScript] = useState('');
  const [duration, setDuration] = useState(5); // 5 or 10
  const [mode, setMode] = useState('std');
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

  const fetchEntitlement = useCallback(async () => {
    try {
      const r = await fetch('/api/entitlement');
      const d = await r.json();
      setEntitlement(d);
      return d;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (authUser) fetchEntitlement();
  }, [authUser, fetchEntitlement]);

  const cost = costForDuration(duration);

  const handleUpload = async (file) => {
    setUploadFile(file);
    setError('');
    setImageBusy('upload');
    try {
      const url = await uploadTempFile(file);
      setImageUrl(url);
      setStep('animate');
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) return;
    setError('');
    setImageBusy('generate');
    try {
      const r = await fetch('/api/ugc-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return;
      }
      if (!r.ok || !data.imageUrl) throw new Error(data.error || 'Image generation failed.');
      setImageUrl(data.imageUrl);
      bumpEntitlement();
      await fetchEntitlement();
      setStep('animate');
    } catch (err) {
      setError(err.message || 'Image generation failed.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleAnimate = async (e) => {
    e.preventDefault();
    if (!imageUrl || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/ugc-animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, script, duration, mode }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return;
      }
      if (!r.ok) throw new Error(data.error || 'Failed to start.');
      setJob({ predictionId: data.predictionId, downloadName: 'ugc.mp4' });
      bumpEntitlement();
      setStep('processing');
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('choose');
    setImageUrl(null);
    setImagePrompt('');
    setUploadFile(null);
    setScript('');
    setJob(null);
    setError('');
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}><p className={styles.subtitle}>Loading…</p></div>
      </main>
    );
  }

  if (step === 'processing' && job) {
    return (
      <main className={styles.page}>
        <Processing
          predictionId={job.predictionId}
          onComplete={(d) => { setJob((p) => ({ ...p, resultUrl: d.resultUrl })); setStep('result'); }}
          onError={(msg) => { setError(msg); setStep('animate'); }}
        />
      </main>
    );
  }

  if (step === 'result' && job) {
    return (
      <main className={styles.page}>
        <Result job={{ ...job, videoFileName: 'character.png' }} onNewSwap={reset} />
      </main>
    );
  }

  if (step === 'paywall') {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ Out of credits</span>
          <h1 className={styles.headline}>Pick a plan to keep going</h1>
        </div>
        <Paywall
          entitlement={entitlement}
          onError={(msg) => setError(msg)}
          onTrialStarted={() => { fetchEntitlement(); setStep('choose'); }}
        />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setStep(imageUrl ? 'animate' : 'choose')}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#ddd',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        </div>
      </main>
    );
  }

  const calloutStyle = {
    maxWidth: 720,
    margin: '12px auto 20px',
    padding: '12px 16px',
    border: '1px solid rgba(224, 196, 136, 0.35)',
    borderRadius: 10,
    background: 'rgba(224, 196, 136, 0.06)',
    color: '#e8d9af',
    fontSize: 13,
    lineHeight: 1.5,
    textAlign: 'center',
  };

  if (step === 'animate' && imageUrl) {
    return (
      <>
        <Head><title>UGC Creator — Haelabs</title></Head>
        <main className={styles.page}>
          <div className={styles.hero}>
            <span className={styles.eyebrow}>◆ Step 2 of 2 — Animate</span>
            <h1 className={styles.headline}>
              Tell your character what to <span className={styles.accent}>do and say</span>
            </h1>
          </div>

          <div style={calloutStyle}>
            ◆ Each <strong>3 seconds</strong> of video costs <strong>1 credit</strong>.
            Output runs on our most expensive video model and takes 2&ndash;4 minutes.
          </div>

          <form className={styles.shell} onSubmit={handleAnimate}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Character"
                style={{ maxWidth: 320, maxHeight: 320, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>

            <label className={styles.field} style={{ display: 'block' }}>
              <span className={styles.swapModeLabel}>Script / direction</span>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={4}
                placeholder="e.g. Smiles at the camera and waves, then says: 'Hey everyone, today I'm reviewing my favorite coffee...'"
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  background: '#0f0f11',
                  color: '#eee',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  resize: 'vertical',
                }}
              />
            </label>

            <div className={styles.swapModeLabel} style={{ marginTop: 16 }}>
              Length: <span style={{ color: '#e0c488' }}>{duration} seconds</span> ·{' '}
              <span style={{ color: '#e0c488' }}>{cost} credit{cost === 1 ? '' : 's'}</span>
            </div>
            <input
              type="range"
              min={5}
              max={10}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#e0c488' }}
              aria-label="Duration"
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888', marginTop: 4 }}>
              <span>5s · 2 credits</span>
              <span>10s · 4 credits</span>
            </div>

            <div className={styles.swapModeLabel} style={{ marginTop: 16 }}>Quality</div>
            <div className={styles.modeRow} role="radiogroup" aria-label="Quality">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'std'}
                className={`${styles.modeBtn} ${mode === 'std' ? styles.modeBtnActive : ''}`}
                onClick={() => setMode('std')}
              >
                <span className={styles.modeName}>Standard</span>
                <span className={styles.modeDetail}>720p · faster</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'pro'}
                className={`${styles.modeBtn} ${mode === 'pro' ? styles.modeBtnActive : ''}`}
                onClick={() => setMode('pro')}
              >
                <span className={styles.modeName}>Pro</span>
                <span className={styles.modeDetail}>1080p · sharper</span>
              </button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
              type="submit"
              className={`${styles.submit} ${styles.submitReady} ${submitting ? styles.submitLoading : ''}`}
              disabled={submitting}
            >
              {submitting && <span className={styles.spinner} aria-hidden="true" />}
              {submitting ? 'Starting…' : `Generate (${cost} credit${cost === 1 ? '' : 's'})`}
            </button>

            <button
              type="button"
              onClick={() => { setImageUrl(null); setStep('choose'); }}
              style={{
                marginTop: 12,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#ddd',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                width: '100%',
              }}
            >
              ← Use a different image
            </button>

            {entitlement && entitlement.canSwap && (
              <div className={styles.usage}>
                {entitlement.creditsRemaining} credit
                {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
              </div>
            )}
          </form>
        </main>
      </>
    );
  }

  // step === 'choose'
  return (
    <>
      <Head><title>UGC Creator — Haelabs</title></Head>
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ Step 1 of 2 — Pick your character</span>
          <h1 className={styles.headline}>
            Make a <span className={styles.accent}>UGC clip</span> in two steps
          </h1>
          <p className={styles.subtitle}>
            Bring your own character image, or generate one from a prompt with our
            top-rated image model.
          </p>
        </div>

        <div style={calloutStyle}>
          ◆ Generating an image costs <strong>1 credit</strong>. The animation in
          step 2 costs <strong>1 credit per 3 seconds</strong> of video.
        </div>

        <div className={styles.shell}>
          <div className={styles.uploads}>
            <div>
              <UploadZone
                label="Upload your own"
                sublabel="JPG or PNG · clear face/body"
                icon="📤"
                accept="image/jpeg,image/png"
                file={uploadFile}
                onFileSelected={handleUpload}
                onRemove={() => { setUploadFile(null); setImageUrl(null); }}
              />
              {imageBusy === 'upload' && (
                <div className={styles.usage} style={{ marginTop: 8 }}>Uploading…</div>
              )}
            </div>

            <div
              style={{
                padding: 16,
                border: '1px dashed rgba(255,255,255,0.18)',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div className={styles.swapModeLabel} style={{ marginTop: 0 }}>
                Or generate one (1 credit)
              </div>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={3}
                placeholder="e.g. A 25-year-old woman with brown hair smiling at the camera, soft studio lighting."
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  background: '#0f0f11',
                  color: '#eee',
                  border: '1px solid rgba(255,255,255,0.12)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  resize: 'vertical',
                  marginTop: 8,
                }}
              />
              <button
                type="button"
                onClick={handleGenerateImage}
                disabled={!imagePrompt.trim() || imageBusy !== null}
                className={`${styles.submit} ${imagePrompt.trim() && imageBusy === null ? styles.submitReady : ''} ${imageBusy === 'generate' ? styles.submitLoading : ''}`}
                style={{ marginTop: 12 }}
              >
                {imageBusy === 'generate' && <span className={styles.spinner} aria-hidden="true" />}
                {imageBusy === 'generate' ? 'Generating…' : 'Generate image (1 credit)'}
              </button>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {entitlement && entitlement.canSwap && (
            <div className={styles.usage}>
              {entitlement.creditsRemaining} credit
              {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
            </div>
          )}
        </div>
      </main>
    </>
  );
}
