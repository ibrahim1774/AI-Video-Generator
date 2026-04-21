import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import Paywall from '../components/Paywall';
import DurationSlider, { costForDuration } from '../components/DurationSlider';
import { uploadTempFile } from '../lib/uploader';
import { getBrowserSupabase } from '../lib/supabase';
import { bumpEntitlement } from '../lib/entitlementBus';
import { saveJob, loadJob, clearJob } from '../lib/jobPersist';
import { maybeCompressImage } from '../lib/imageCompress';

const FEATURE = 'ugc';
const MAX_SCENES = 5;

let sceneIdSeed = 1;
function newScene(duration = 5) {
  sceneIdSeed += 1;
  return { id: sceneIdSeed, prompt: '', duration };
}

export default function UgcPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // 'choose' | 'gen-image' | 'animate' | 'processing' | 'result' | 'paywall'
  const [step, setStep] = useState('choose');
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(null); // 'upload' | 'generate' | null
  const [imagePrompt, setImagePrompt] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [imageJob, setImageJob] = useState(null); // { predictionId, startedAt }

  const [script, setScript] = useState('');
  const [duration, setDuration] = useState(5); // 3–15
  const [mode, setMode] = useState('std');
  const [audio, setAudio] = useState(true);
  const [animateMode, setAnimateMode] = useState('single'); // 'single' | 'storyboard'
  const [scenes, setScenes] = useState(() => [newScene()]);
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

  // Resume an in-flight job from localStorage. UGC has two kinds of
  // job — image generation (kind='ugc-image') and animation (kind='ugc-animate').
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const saved = loadJob(FEATURE);
    if (!saved || !saved.predictionId) return;
    if (saved.kind === 'ugc-image') {
      setImageJob({
        predictionId: saved.predictionId,
        startedAt: saved.startedAt,
      });
      setStep('gen-image');
    } else if (saved.kind === 'ugc-animate') {
      setJob({
        predictionId: saved.predictionId,
        downloadName: saved.downloadName || 'ugc.mp4',
        startedAt: saved.startedAt,
        vendor: saved.vendor || 'replicate',
      });
      setImageUrl(saved.imageUrl || null);
      setStep('processing');
    }
  }, [authLoaded, authUser]);

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

  const totalSeconds =
    animateMode === 'storyboard'
      ? scenes.reduce((a, s) => a + s.duration, 0)
      : duration;
  const cost = costForDuration(totalSeconds);
  const storyboardValid =
    animateMode !== 'storyboard' ||
    (scenes.length > 0 && scenes.every((s) => s.prompt.trim().length > 0));

  const updateScene = (id, patch) => {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const addScene = () => {
    setScenes((prev) => (prev.length >= MAX_SCENES ? prev : [...prev, newScene()]));
  };
  const removeScene = (id) => {
    setScenes((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  };

  const handleUpload = async (file) => {
    setUploadFile(file);
    setError('');
    setImageBusy('upload');
    try {
      const compressed = await maybeCompressImage(file);
      const url = await uploadTempFile(compressed);
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
      if (!r.ok || !data.predictionId) throw new Error(data.error || 'Image generation failed.');
      const startedAt = Date.now();
      saveJob(FEATURE, {
        kind: 'ugc-image',
        predictionId: data.predictionId,
        startedAt,
      });
      setImageJob({ predictionId: data.predictionId, startedAt });
      bumpEntitlement();
      setStep('gen-image');
    } catch (err) {
      setError(err.message || 'Image generation failed.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleAnimate = async (e) => {
    e.preventDefault();
    if (!imageUrl || submitting) return;
    if (animateMode === 'storyboard' && !storyboardValid) {
      setError('Each scene needs a prompt before generating.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body =
        animateMode === 'storyboard'
          ? {
              imageUrl,
              mode,
              audio,
              scenes: scenes.map((s) => ({ prompt: s.prompt, duration: s.duration })),
            }
          : { imageUrl, script, duration, mode, audio };
      const r = await fetch('/api/ugc-animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return;
      }
      if (!r.ok) throw new Error(data.error || 'Failed to start.');
      const startedAt = Date.now();
      const newJob = {
        predictionId: data.predictionId,
        downloadName: 'ugc.mp4',
        startedAt,
        vendor: 'kie',
      };
      saveJob(FEATURE, {
        kind: 'ugc-animate',
        ...newJob,
        imageUrl,
      });
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
    setStep('choose');
    setImageUrl(null);
    setImagePrompt('');
    setUploadFile(null);
    setScript('');
    setJob(null);
    setImageJob(null);
    setAnimateMode('single');
    setScenes([newScene()]);
    setAudio(true);
    setError('');
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}><p className={styles.subtitle}>Loading…</p></div>
      </main>
    );
  }

  if (step === 'gen-image' && imageJob) {
    return (
      <main className={styles.page}>
        <Processing
          predictionId={imageJob.predictionId}
          startedAt={imageJob.startedAt}
          kind="image"
          onComplete={(data) => {
            clearJob(FEATURE);
            if (!data.resultUrl) {
              setError('Image generation returned no result.');
              setStep('choose');
              return;
            }
            setImageUrl(data.resultUrl);
            setImageJob(null);
            fetchEntitlement();
            setStep('animate');
          }}
          onError={(msg) => {
            clearJob(FEATURE);
            setImageJob(null);
            setError(msg);
            setStep('choose');
          }}
        />
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
          onComplete={(d) => {
            clearJob(FEATURE);
            setJob((p) => ({ ...p, resultUrl: d.resultUrl }));
            setStep('result');
          }}
          onError={(msg) => {
            clearJob(FEATURE);
            setError(msg);
            setStep('animate');
          }}
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
            ◆ Powered by Kling 3.0 — <strong>3&ndash;15 seconds</strong> per scene with
            optional native audio. <strong>1 credit per 3 seconds</strong> of video.
            Generation takes 2&ndash;4 minutes.
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

            <div className={styles.modeRow} role="radiogroup" aria-label="Animate mode">
              <button
                type="button"
                role="radio"
                aria-checked={animateMode === 'single'}
                className={`${styles.modeBtn} ${animateMode === 'single' ? styles.modeBtnActive : ''}`}
                onClick={() => setAnimateMode('single')}
              >
                <span className={styles.modeName}>Single scene</span>
                <span className={styles.modeDetail}>One clip, 3&ndash;15 seconds</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={animateMode === 'storyboard'}
                className={`${styles.modeBtn} ${animateMode === 'storyboard' ? styles.modeBtnActive : ''}`}
                onClick={() => setAnimateMode('storyboard')}
              >
                <span className={styles.modeName}>Storyboard</span>
                <span className={styles.modeDetail}>Up to 5 scenes, continuous audio</span>
              </button>
            </div>

            {animateMode === 'single' ? (
              <>
                <label className={styles.field} style={{ display: 'block', marginTop: 16 }}>
                  <span className={styles.swapModeLabel}>Script / direction</span>
                  <textarea
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    rows={4}
                    placeholder='e.g. Smiles and waves at the camera, then says: "Hey everyone, today I am reviewing my favorite coffee."'
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
                  <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
                    Tip: put dialogue in &ldquo;quotes&rdquo; so the model lip-syncs it.
                  </div>
                </label>

                <DurationSlider value={duration} onChange={setDuration} />
              </>
            ) : (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: '#bbb',
                    marginBottom: 12,
                    lineHeight: 1.5,
                  }}
                >
                  Chain up to 5 scenes into one continuous video. Your character carries
                  through every shot, and audio flows across scenes.
                </div>
                {scenes.map((scene, idx) => (
                  <div
                    key={scene.id}
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 10,
                      padding: 14,
                      marginBottom: 12,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: '#e0c488',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          flex: 1,
                        }}
                      >
                        Scene {idx + 1}
                      </span>
                      {scenes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeScene(scene.id)}
                          aria-label={`Remove scene ${idx + 1}`}
                          style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#bbb',
                            borderRadius: 6,
                            padding: '4px 10px',
                            fontSize: 11,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <textarea
                      value={scene.prompt}
                      onChange={(e) => updateScene(scene.id, { prompt: e.target.value })}
                      rows={3}
                      placeholder={
                        idx === 0
                          ? 'e.g. Walks into a sunlit kitchen and says: "Today I\'m showing you my morning routine."'
                          : 'What happens next? Describe the action and any dialogue in "quotes".'
                      }
                      style={{
                        width: '100%',
                        padding: 10,
                        borderRadius: 8,
                        background: '#0f0f11',
                        color: '#eee',
                        border: '1px solid rgba(255,255,255,0.12)',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        resize: 'vertical',
                      }}
                    />
                    <DurationSlider
                      value={scene.duration}
                      onChange={(v) => updateScene(scene.id, { duration: v })}
                      label={`Scene ${idx + 1} length`}
                      min={1}
                      max={12}
                      ariaLabel={`Scene ${idx + 1} duration`}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addScene}
                  disabled={scenes.length >= MAX_SCENES}
                  style={{
                    width: '100%',
                    padding: 10,
                    background: 'transparent',
                    border: '1px dashed rgba(224, 196, 136, 0.4)',
                    color: '#e0c488',
                    borderRadius: 8,
                    cursor: scenes.length >= MAX_SCENES ? 'not-allowed' : 'pointer',
                    opacity: scenes.length >= MAX_SCENES ? 0.4 : 1,
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                >
                  + Add scene {scenes.length >= MAX_SCENES ? '(max 5)' : ''}
                </button>
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    background: 'rgba(224, 196, 136, 0.06)',
                    border: '1px solid rgba(224, 196, 136, 0.25)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#e8d9af',
                    textAlign: 'center',
                  }}
                >
                  Total {totalSeconds}s · {cost} credit{cost === 1 ? '' : 's'}
                </div>
              </div>
            )}

            <div className={styles.swapModeLabel} style={{ marginTop: 16 }}>Audio</div>
            <div className={styles.modeRow} role="radiogroup" aria-label="Audio">
              <button
                type="button"
                role="radio"
                aria-checked={audio === true}
                className={`${styles.modeBtn} ${audio === true ? styles.modeBtnActive : ''}`}
                onClick={() => setAudio(true)}
              >
                <span className={styles.modeName}>With audio</span>
                <span className={styles.modeDetail}>Dialogue, lip-sync, ambient SFX</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={audio === false}
                className={`${styles.modeBtn} ${audio === false ? styles.modeBtnActive : ''}`}
                onClick={() => setAudio(false)}
              >
                <span className={styles.modeName}>Silent</span>
                <span className={styles.modeDetail}>Video only &middot; cheaper output</span>
              </button>
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
                maxSizeMB={50}
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
                {imageBusy === 'generate' ? 'Starting…' : 'Generate image (1 credit)'}
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
