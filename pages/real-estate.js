import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Paywall from '../components/Paywall';
import AuthModal from '../components/AuthModal';
import DurationSlider, {
  snapToStandardPreset,
  STANDARD_DURATION_PRESETS,
} from '../components/DurationSlider';
import ModelPicker from '../components/ModelPicker';
import ResolutionPicker from '../components/ResolutionPicker';
import { uploadTempFile } from '../lib/uploader';
import { getBrowserSupabase } from '../lib/supabase';
import { bumpEntitlement } from '../lib/entitlementBus';
import { saveJob, loadJob, clearJob } from '../lib/jobPersist';
import {
  loadStory,
  saveStory,
  clearStory,
  appendScene,
  popScene,
  setCombinedUrl,
} from '../lib/storyPersist';
import { maybeCompressImage } from '../lib/imageCompress';

const FEATURE = 'real-estate';
const MAX_SCENES = 5;

function triggerDownload(url, filename) {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'video.mp4';
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {}
}

export default function RealEstatePage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // 'choose' | 'gen-image' | 'animate' | 'processing'
  // | 'result' | 'extending' | 'combining' | 'final' | 'paywall'
  const [step, setStep] = useState('choose');
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBusy, setImageBusy] = useState(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [imageJob, setImageJob] = useState(null);

  const [script, setScript] = useState('');
  const [duration, setDuration] = useState(4);
  const [model, setModel] = useState('standard');
  const [resolution, setResolution] = useState('480p');
  const [audio, setAudio] = useState(false);

  // 'photo' = upload + prompt + length (default; current behavior).
  // 'text'  = prompt + length only; sent without imageUrl so the model
  //           runs text-to-video (Seedance + Kling both support this).
  // Persisted to localStorage along with the script so the choice (and
  // typed prompt) survives the signup-popup detour on the funnel.
  const [mode, setMode] = useState('photo');
  const MODE_KEY = 'ariyalab:real-estate:mode';
  const SCRIPT_KEY = 'ariyalab:real-estate:script';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const m = window.localStorage.getItem(MODE_KEY);
      if (m === 'photo' || m === 'text') setMode(m);
      const s = window.localStorage.getItem(SCRIPT_KEY);
      if (typeof s === 'string') setScript(s);
    } catch {}
    // mount-only; intentionally no deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(MODE_KEY, mode); } catch {}
  }, [mode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(SCRIPT_KEY, script); } catch {}
  }, [script]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [entitlement, setEntitlement] = useState(null);

  // Chain state. `story` is the persisted list of completed scenes.
  // `nextSceneType` tells handleAnimate how to build the saved-scene
  // metadata (initial / extend / new). `pendingStartImage` is the
  // image URL to use for the NEXT animation (an extracted last frame
  // or a freshly uploaded image for a New scene).
  const [story, setStory] = useState(null);
  const [nextSceneType, setNextSceneType] = useState('initial');
  const [pendingStartImage, setPendingStartImage] = useState(null);

  // Sign-up modal for the anonymous landing CTA.
  const [authModalOpen, setAuthModalOpen] = useState(false);

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

  // /ugc is now a public landing for anon visitors. No redirect.

  // Resume in-flight jobs + rehydrate the story on mount.
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const savedStory = loadStory(FEATURE);
    if (savedStory && savedStory.scenes.length > 0) {
      setStory(savedStory);
      // If no active job mid-flight, land the user on the result/final
      // screen of the stored story.
      setImageUrl(savedStory.startingImageUrl || null);
    }
    const saved = loadJob(FEATURE);
    if (!saved || !saved.predictionId) {
      if (savedStory && savedStory.scenes.length > 0) {
        setStep(savedStory.combinedUrl ? 'final' : 'result');
      }
      return;
    }
    if (saved.kind === 'ugc-image') {
      setImageJob({ predictionId: saved.predictionId, startedAt: saved.startedAt });
      setStep('gen-image');
    } else if (saved.kind === 'ugc-animate') {
      setJob({
        predictionId: saved.predictionId,
        downloadName: saved.downloadName || 'ugc.mp4',
        startedAt: saved.startedAt,
        vendor: saved.vendor || 'kie',
        sceneMeta: saved.sceneMeta || null,
      });
      if (saved.imageUrl) setImageUrl(saved.imageUrl);
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

  const storyScenes = story?.scenes || [];
  const latestScene = storyScenes[storyScenes.length - 1] || null;
  const atSceneCap = storyScenes.length >= MAX_SCENES;

  const handleUpload = async (file) => {
    // UGC-3: anonymous visitors fill the WHOLE form first (upload +
    // script + length), and only hit the sign-up gate when they press
    // Generate (see handleAnimate). So we do NOT intercept anon uploads
    // here. Uploads use screenMode 'skip' (no pre-subscribe filter).
    setUploadFile(file);
    setError('');
    setImageBusy('upload');
    try {
      const compressed = await maybeCompressImage(file);
      // Homepage keeps the upload-time NSFW/minor pre-screen ON — this is
      // the highest-traffic surface. Default screenMode screens images.
      const url = await uploadTempFile(compressed);
      setImageUrl(url);
      // If this upload is a "New scene" image, use it as the start
      // image for the next animation instead of replacing the story's
      // anchor character.
      if (nextSceneType === 'new') {
        setPendingStartImage(url);
      }
      // Stay on the choose view — the script + knobs + Generate button
      // live inline below the upload zone now.
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) return;
    if (!authUser) {
      setAuthModalOpen(true);
      return;
    }
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

  // The image to use as the starting frame for the next animate call.
  // pendingStartImage > imageUrl. After success we clear pendingStartImage.
  const effectiveStartImage = pendingStartImage || imageUrl;

  const handleAnimate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    // Per-mode gate: photo needs an image; text needs a prompt.
    if (mode === 'photo' && !effectiveStartImage) return;
    if (mode === 'text' && !script.trim()) return;
    if (!authUser) {
      setAuthModalOpen(true);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // Text mode omits imageUrl entirely → backend routes to the
      // text-to-video path on Seedance/Kling.
      const body = mode === 'text'
        ? { script, duration, model, resolution, audio }
        : { imageUrl: effectiveStartImage, script, duration, model, resolution, audio };
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
      const sceneMeta = {
        startImageUrl: effectiveStartImage,
        prompt: script,
        duration,
        model,
        resolution,
        audio,
        type: nextSceneType,
      };
      const newJob = {
        predictionId: data.predictionId,
        downloadName: 'ugc.mp4',
        startedAt,
        vendor: 'kie',
        sceneMeta,
      };
      saveJob(FEATURE, {
        kind: 'ugc-animate',
        ...newJob,
        imageUrl: effectiveStartImage,
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

  const onSceneComplete = useCallback(
    (resultUrl) => {
      clearJob(FEATURE);
      const meta = job?.sceneMeta || {
        startImageUrl: effectiveStartImage,
        prompt: script,
        duration,
        model,
        resolution,
        audio,
        type: nextSceneType,
      };
      const scene = {
        id: `scene_${Date.now()}`,
        predictionId: job?.predictionId,
        videoUrl: resultUrl,
        ...meta,
        startedAt: job?.startedAt || Date.now(),
      };
      const next = appendScene(FEATURE, scene, story?.startingImageUrl || imageUrl);
      setStory(next);
      setJob(null);
      // Reset per-scene state so the next Extend/New opens a clean form.
      setScript('');
      setPendingStartImage(null);
      setNextSceneType('initial');
      setStep('result');
    },
    [job, effectiveStartImage, script, duration, model, resolution, audio, nextSceneType, story, imageUrl]
  );

  const onSceneError = useCallback((msg) => {
    clearJob(FEATURE);
    setError(msg);
    setJob(null);
    // If we already have at least one scene, return the user to the
    // result panel so they can retry; otherwise back to the animate
    // form.
    setStep(storyScenes.length > 0 ? 'result' : 'animate');
  }, [storyScenes.length]);

  const handleExtend = async () => {
    if (!latestScene?.videoUrl || atSceneCap) return;
    setError('');
    setStep('extending');
    try {
      const r = await fetch('/api/extract-last-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: latestScene.videoUrl }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.frameUrl) {
        throw new Error(data.error || 'Could not read the last frame of the previous scene.');
      }
      setPendingStartImage(data.frameUrl);
      setNextSceneType('extend');
      setScript('');
      setStep('animate');
    } catch (err) {
      setError(err.message || 'Extend failed.');
      setStep('result');
    }
  };

  const handleNewScene = () => {
    if (atSceneCap) return;
    setError('');
    setPendingStartImage(null);
    setNextSceneType('new');
    setUploadFile(null);
    setImagePrompt('');
    setStep('choose');
  };

  const handleCombine = async () => {
    if (storyScenes.length < 2) return;
    setError('');
    setStep('combining');
    try {
      const r = await fetch('/api/concat-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrls: storyScenes.map((s) => s.videoUrl).filter(Boolean),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.combinedUrl) {
        throw new Error(data.error || 'Could not combine scenes.');
      }
      const next = setCombinedUrl(FEATURE, data.combinedUrl);
      if (next) setStory(next);
      setStep('final');
    } catch (err) {
      setError(err.message || 'Combine failed.');
      setStep('result');
    }
  };

  const handleUndo = () => {
    const next = popScene(FEATURE);
    setStory(next || null);
    if (!next || next.scenes.length === 0) {
      resetStory();
    } else {
      setStep('result');
    }
  };

  const resetStory = () => {
    clearJob(FEATURE);
    clearStory(FEATURE);
    setStory(null);
    setStep('choose');
    setImageUrl(null);
    setImagePrompt('');
    setUploadFile(null);
    setScript('');
    setJob(null);
    setImageJob(null);
    setAudio(true);
    setModel('standard');
    setResolution('480p');
    setDuration(4);
    setPendingStartImage(null);
    setNextSceneType('initial');
    setError('');
  };

  if (!authLoaded) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}><p className={styles.subtitle}>Loading…</p></div>
      </main>
    );
  }

  // Authed but no active plan: drop straight onto the paywall page so
  // the user picks a plan before any creator UI is shown. `entitlement`
  // may still be null on the first render after sign-up; in that case
  // we let the existing flow render (and the 402 path in handleAnimate /
  // handleGenerateImage covers anyone who races the entitlement load).
  if (entitlement && entitlement.tier === 'none' && !entitlement.canSwap) {
    return (
      <>
        <Head><title>Pick a Plan — Ariya Lab</title></Head>
        <main className={styles.page}>
          <div className={styles.hero}>
            <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>◆ Pick a Plan</span>
            <h1 className={styles.headline}>
              Start creating <span className={styles.accent}>AI videos</span>
            </h1>
          </div>
          <Paywall
            entitlement={entitlement}
            returnTo="/real-estate"
            surface="real-estate"
            onError={(msg) => setError(msg)}
            onTrialStarted={() => { fetchEntitlement(); setStep('choose'); }}
          />
        </main>
      </>
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
            if (nextSceneType === 'new') setPendingStartImage(data.resultUrl);
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
          historyKind="ugc"
          onComplete={(d) => onSceneComplete(d.resultUrl)}
          onError={onSceneError}
        />
      </main>
    );
  }

  if (step === 'extending') {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>◆ Extending</span>
          <h1 className={styles.headline}>
            Reading the <span className={styles.accent}>last frame</span>
          </h1>
          <p className={styles.subtitle}>
            Grabbing the final frame from your last scene so the next one starts
            exactly where that one ended. Usually under 15 seconds.
          </p>
        </div>
      </main>
    );
  }

  if (step === 'combining') {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>◆ Combining</span>
          <h1 className={styles.headline}>
            Stitching your <span className={styles.accent}>scenes together</span>
          </h1>
          <p className={styles.subtitle}>
            Concatenating {storyScenes.length} clips into one MP4. Usually under
            30 seconds.
          </p>
        </div>
      </main>
    );
  }

  if (step === 'final' && story?.combinedUrl) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>◆ Done</span>
          <h1 className={styles.headline}>
            Your story is <span className={styles.accent}>ready</span>
          </h1>
          <p className={styles.subtitle}>
            {storyScenes.length} scenes combined into one video.
          </p>
        </div>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px' }}>
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), var(--shadow-xl)',
            overflow: 'hidden',
            background: 'var(--surface-0)',
          }}>
            <video
              src={story.combinedUrl}
              controls
              style={{ width: '100%', display: 'block', background: '#000' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => triggerDownload(story.combinedUrl, 'ariyalab-story.mp4')}
              className={`${styles.submit} ${styles.submitReady}`}
              style={{ flex: 1, minWidth: 200 }}
            >
              ↓ Download combined
            </button>
            <button
              type="button"
              onClick={() => setStep('result')}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 160, justifyContent: 'center' }}
            >
              ← Back to scenes
            </button>
            <button
              type="button"
              onClick={resetStory}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 160, justifyContent: 'center' }}
            >
              + New story
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (step === 'result' && storyScenes.length > 0) {
    const featured = latestScene;
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>
            ◆ Scene {storyScenes.length} of {MAX_SCENES} &middot; saved
          </span>
          <h1 className={styles.headline}>
            Your scene is <span className={styles.accent}>ready</span>
          </h1>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px' }}>
          {/* Latest scene video — glass frame */}
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), var(--shadow-xl)',
            overflow: 'hidden',
            background: 'var(--surface-0)',
          }}>
            <video
              key={featured?.id}
              src={featured?.videoUrl}
              controls
              style={{ width: '100%', display: 'block', background: '#000' }}
            />
          </div>

          {/* Story rail */}
          {storyScenes.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 12,
                overflowX: 'auto',
                padding: '4px 0',
              }}
            >
              {storyScenes.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    flex: '0 0 auto',
                    width: 120,
                    border: `1px solid ${s.id === featured.id ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                    background: 'var(--surface-1)',
                    boxShadow: s.id === featured.id ? 'inset 0 1px 0 rgba(255,255,255,0.1), var(--shadow-md)' : 'none',
                    transition: 'border-color 0.2s var(--ease)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.startImageUrl}
                    alt={`Scene ${i + 1}`}
                    style={{ width: '100%', height: 80, objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{
                    padding: '5px 8px',
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.06em',
                  }}>
                    SCENE {i + 1} · {s.duration}S {s.type === 'extend' ? '↪' : s.type === 'new' ? '+' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className={styles.error} style={{ marginTop: 16 }}>{error}</div>}

          <div
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 'var(--radius-md)',
              fontSize: 11,
              color: 'var(--text-faint)',
              lineHeight: 1.55,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            EACH SCENE GENERATES ITS OWN AUDIO TRACK. VOICE AND AMBIENT SOUND
            WILL CHANGE AT THE SCENE SEAM.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              onClick={handleExtend}
              disabled={atSceneCap}
              className={`${styles.submit} ${styles.submitReady}`}
              style={atSceneCap ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              ↪ Extend scene
            </button>
            <button
              type="button"
              onClick={handleNewScene}
              disabled={atSceneCap}
              className="btn-ghost"
              style={atSceneCap ? { opacity: 0.4, cursor: 'not-allowed', width: '100%', justifyContent: 'center' } : { width: '100%', justifyContent: 'center' }}
            >
              + New scene
            </button>
          </div>

          {atSceneCap && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              5-SCENE CAP REACHED — COMBINE OR START A NEW STORY
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {storyScenes.length >= 2 && (
              <button
                type="button"
                onClick={handleCombine}
                className="btn-ghost"
                style={{ flex: 1, minWidth: 180, justifyContent: 'center' }}
              >
                ↓ Combine &amp; download ({storyScenes.length} scenes)
              </button>
            )}
            <button
              type="button"
              onClick={() => triggerDownload(featured.videoUrl, `scene-${storyScenes.length}.mp4`)}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 140, justifyContent: 'center' }}
            >
              ↓ Scene {storyScenes.length}
            </button>
            {storyScenes.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="btn-ghost"
                style={{ flex: 1, minWidth: 120, justifyContent: 'center' }}
              >
                ⌫ Undo last
              </button>
            )}
            <button
              type="button"
              onClick={resetStory}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 120, justifyContent: 'center' }}
            >
              + New story
            </button>
          </div>

          {/* UGC-3: credits-remaining badge intentionally hidden */}
        </div>
      </main>
    );
  }

  if (step === 'paywall') {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>◆ Out of Credits</span>
          <h1 className={styles.headline}>
            Pick a plan to <span className={styles.accent}>keep going</span>
          </h1>
        </div>
        <Paywall
          entitlement={entitlement}
          returnTo="/real-estate"
          surface="real-estate"
          onError={(msg) => setError(msg)}
          onTrialStarted={() => { fetchEntitlement(); setStep(storyScenes.length > 0 ? 'result' : 'choose'); }}
        />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setStep(storyScenes.length > 0 ? 'result' : (imageUrl ? 'animate' : 'choose'))}
            className="btn-ghost"
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
    padding: '12px 20px',
    borderRadius: 'var(--radius-lg)',
    lineHeight: 1.55,
    textAlign: 'center',
  };

  if (step === 'animate' && effectiveStartImage) {
    const eyebrow =
      nextSceneType === 'extend'
        ? `◆ Scene ${storyScenes.length + 1} of ${MAX_SCENES} — continuing from last frame`
        : nextSceneType === 'new'
          ? `◆ Scene ${storyScenes.length + 1} of ${MAX_SCENES} — new image`
          : '◆ Tell your character what to do';

    return (
      <>
        <Head><title>UGC Creator — Ariya Lab</title></Head>
        <main className={styles.page}>
          <div className={styles.hero}>
            <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>{eyebrow}</span>
            <h1 className={styles.headline}>
              Tell your character what to <span className={styles.accent}>do and say</span>
            </h1>
          </div>

          <div style={{
            ...calloutStyle,
            background: 'radial-gradient(130% 70% at 50% -10%, rgba(255,255,255,0.05), transparent 56%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
            backdropFilter: 'blur(12px) saturate(130%)',
            WebkitBackdropFilter: 'blur(12px) saturate(130%)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), var(--shadow-sm)',
            borderRadius: 'var(--radius-lg)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--text-dim)',
          }}>
            ◆ POWERED BY KLING 3.0 — <strong style={{ color: 'var(--text)', fontWeight: 600 }}>3–15 SECONDS</strong> PER SCENE WITH
            OPTIONAL NATIVE AUDIO. <strong style={{ color: 'var(--text)', fontWeight: 600 }}>1 CREDIT PER SECOND</strong> OF VIDEO.
            GENERATION TAKES 2–4 MINUTES.
          </div>

          <form className={styles.shell} onSubmit={handleAnimate}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={effectiveStartImage}
                alt="Starting frame"
                style={{
                  maxWidth: 320,
                  maxHeight: 320,
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), var(--shadow-xl)',
                }}
              />
            </div>

            <label className={styles.field} style={{ display: 'block' }}>
              <span
                style={{
                  display: 'block',
                  marginBottom: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                }}
              >
                Script / Direction
              </span>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={4}
                placeholder='e.g. Smiles and waves at the camera, then says: "Hey everyone, today I am reviewing my favorite coffee."'
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(0,0,0,0.35)',
                  color: 'var(--text)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.4)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  transition: 'border-color 0.2s var(--ease), box-shadow 0.2s var(--ease)',
                }}
              />
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                TIP: PUT DIALOGUE IN &ldquo;QUOTES&rdquo; SO THE MODEL LIP-SYNCS IT
              </div>
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

            <button
              type="submit"
              className={`${styles.submit} ${styles.submitReady} ${submitting ? styles.submitLoading : ''}`}
              disabled={submitting}
            >
              {submitting && <span className={styles.spinner} aria-hidden="true" />}
              {submitting ? 'Starting…' : 'Generate'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (storyScenes.length > 0) {
                  // Back to story instead of losing state.
                  setPendingStartImage(null);
                  setNextSceneType('initial');
                  setStep('result');
                } else {
                  setImageUrl(null);
                  setStep('choose');
                }
              }}
              className="btn-ghost"
              style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}
            >
              ← {storyScenes.length > 0 ? 'Back to scenes' : 'Use a different image'}
            </button>

            {/* UGC-3: credits-remaining badge intentionally hidden */}
          </form>
        </main>

        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          initialMode="signup"
          redirectTo="/real-estate"
        />
      </>
    );
  }

  // step === 'choose'
  // Prompt-to-character generator costs 1 credit, so it only makes
  // sense to surface for users on a paid plan (or trialing). Anon
  // and free users see the upload box only.
  const canUsePromptGenerator =
    entitlement?.tier === 'monthly' ||
    entitlement?.tier === 'yearly' ||
    entitlement?.status === 'trialing';
  return (
    <>
      <Head><title>Real Estate Listing Videos — Ariya Lab</title></Head>
      <main className={styles.page} style={{ paddingTop: 8 }}>
        <div className={styles.hero} style={{ marginBottom: 16, textAlign: 'center' }}>
          <span className={styles.eyebrow} style={{ marginBottom: 16, display: 'inline-flex' }}>
            ◆ Real Estate Video Studio
          </span>
          <h1
            className={styles.headline}
            style={{
              fontSize: 'clamp(32px, 5vw, 60px)',
              margin: '0 auto 18px',
              lineHeight: 1.08,
              letterSpacing: '-0.025em',
              maxWidth: 760,
              color: 'var(--text)',
            }}
          >
            Keep your social media{' '}
            <span className={styles.accent}>active</span>
            {' '}—{' '}
            without getting on camera
          </h1>
          <p
            className={styles.subtitle}
            style={{
              margin: '0 auto 20px',
              maxWidth: 520,
              fontSize: 15,
            }}
          >
            Type what you want to announce — a new listing, an open house, a
            market update — and Ariya Lab builds the video in minutes.
          </p>

          {/* Mode toggle — centered pill, pairs visually with ModelPicker.
              Switching to 'text' clears any uploaded image so a stale
              upload can't leak into the next generate. */}
          <div
            role="tablist"
            aria-label="Generation mode"
            style={{
              display: 'inline-flex',
              margin: '0 auto',
              padding: 4,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), var(--shadow-sm)',
            }}
          >
            {[
              { key: 'photo', label: 'With photo' },
              { key: 'text', label: 'Text only' },
            ].map((opt) => {
              const active = mode === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (opt.key === mode) return;
                    if (opt.key === 'text') {
                      // Drop any pending photo so it can't slip into the
                      // text-mode generate payload.
                      setUploadFile(null);
                      setImageUrl(null);
                      setPendingStartImage(null);
                    }
                    setMode(opt.key);
                  }}
                  style={{
                    padding: '9px 20px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent',
                    background: active ? 'linear-gradient(180deg,#ffffff,#d4d4da)' : 'transparent',
                    color: active ? '#0a0a0b' : 'var(--text-dim)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    letterSpacing: '0.01em',
                    transition: 'background 180ms var(--ease), color 180ms var(--ease), border-color 180ms var(--ease)',
                    boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.85), 0 4px 12px rgba(255,255,255,0.15)' : 'none',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p
            style={{
              margin: '10px auto 0',
              maxWidth: 480,
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-faint)',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            {mode === 'photo'
              ? 'ANIMATES YOUR LISTING, PROPERTY SHOT, OR HEADSHOT'
              : 'AI INVENTS THE SCENE — BEST FOR NEIGHBORHOODS, LIFESTYLE, B-ROLL'}
          </p>
        </div>

        <form onSubmit={handleAnimate} className={styles.ugcCard}>
          {/* 1. Add your character — hidden entirely in text-only mode */}
          {mode === 'photo' && (
          <section className={styles.ugcSection}>
            <h3 className={styles.ugcSectionTitle}>1. Add your character</h3>
            <UploadZone
              label="Upload image"
              sublabel="JPG or PNG · clear face/body"
              icon="📤"
              accept="image/*"
              file={uploadFile}
              onFileSelected={handleUpload}
              onRemove={() => { setUploadFile(null); setImageUrl(null); }}
              maxSizeMB={1024}
              compact
            />
            {imageBusy === 'upload' && (
              <div className={styles.usage} style={{ marginTop: 8 }}>Uploading…</div>
            )}

            {canUsePromptGenerator && (
              <>
                <div className={styles.ugcOr}>
                  <span className={styles.ugcOrLine} />
                  <span className={styles.ugcOrText}>OR</span>
                  <span className={styles.ugcOrLine} />
                </div>
                <details className={styles.ugcDisclosure}>
                  <summary className={styles.ugcDisclosureSummary}>
                    <span className={styles.ugcDisclosureIcon} aria-hidden="true">✦</span>
                    <span className={styles.ugcDisclosureLabel}>
                      <span className={styles.ugcDisclosureTitle}>Describe your character</span>
                      <span className={styles.ugcDisclosureHint}>e.g. a woman in a white shirt, sitting in a cafe</span>
                    </span>
                    <span className={styles.ugcDisclosureChevron} aria-hidden="true">⌄</span>
                  </summary>
                  <div className={styles.ugcDisclosureBody}>
                    <textarea
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      rows={3}
                      placeholder="e.g. A 25-year-old woman with brown hair smiling at the camera, soft studio lighting."
                      className={styles.ugcTextarea}
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
                </details>
              </>
            )}
          </section>
          )}

          {/* 2. Script */}
          <section className={styles.ugcSection}>
            <h3 className={styles.ugcSectionTitle}>
              {mode === 'photo' ? '2. ' : '1. '}What should they say &amp; do?
            </h3>
            <div className={styles.ugcTextareaWrap}>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value.slice(0, 500))}
                rows={3}
                maxLength={500}
                placeholder='e.g. Smiles and waves, then says: "Hey everyone, today I am reviewing my favorite coffee."'
                className={styles.ugcTextarea}
              />
              <span className={styles.ugcCharCount}>{script.length} / 500</span>
            </div>
          </section>

          {/* 3. Video length */}
          <section className={styles.ugcSection}>
            <h3 className={styles.ugcSectionTitle}>
              {mode === 'photo' ? '3. ' : '2. '}Video length
            </h3>
            {model === 'standard' ? (
              <div
                role="radiogroup"
                aria-label="Video length"
                style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
              >
                {STANDARD_DURATION_PRESETS.map((sec) => {
                  const selected = duration === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setDuration(sec)}
                      style={{
                        flex: '1 1 0',
                        padding: '14px 12px',
                        borderRadius: 12,
                        border: selected
                          ? '1px solid rgba(255,255,255,0.55)'
                          : '1px solid rgba(255,255,255,0.12)',
                        background: selected ? '#ededed' : '#0f0f11',
                        color: selected ? '#0b0b0c' : '#ededed',
                        fontFamily: 'inherit',
                        fontSize: 15,
                        fontWeight: selected ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'background 120ms ease, color 120ms ease',
                      }}
                    >
                      {sec}s
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <input
                  type="range"
                  min={3}
                  max={15}
                  step={1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className={styles.ugcSlider}
                  aria-label="Video length"
                />
                <div className={styles.ugcSliderLabels}>
                  <div className={styles.ugcSliderTick}>
                    <span className={styles.ugcSliderTickValue}>3s</span>
                    <span className={styles.ugcSliderTickLabel}>Short</span>
                  </div>
                  <div className={styles.ugcSliderTick} style={{ textAlign: 'center' }}>
                    <span className={styles.ugcSliderTickValue}>{duration}s</span>
                    <span className={styles.ugcSliderTickLabel}>
                      {duration <= 5 ? 'Short' : duration <= 9 ? 'Medium' : 'Long'}
                    </span>
                  </div>
                  <div className={styles.ugcSliderTick} style={{ textAlign: 'right' }}>
                    <span className={styles.ugcSliderTickValue}>15s</span>
                    <span className={styles.ugcSliderTickLabel}>Long</span>
                  </div>
                </div>
              </>
            )}
          </section>

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

          {error && <div className={styles.error}>{error}</div>}

          {(() => {
            const canGenerate = mode === 'text'
              ? Boolean(script.trim())
              : Boolean(effectiveStartImage);
            const ctaIdleLabel = mode === 'text'
              ? (canGenerate ? 'Generate video' : 'Type a prompt to continue')
              : (canGenerate ? 'Generate video' : 'Upload an image to continue');
            return (
              <button
                type="submit"
                className={`${styles.ugcCta} ${(!canGenerate || submitting) ? styles.ugcCtaDisabled : ''}`}
                disabled={!canGenerate || submitting}
              >
                {submitting && <span className={styles.spinner} aria-hidden="true" />}
                <span className={styles.ugcCtaIcon} aria-hidden="true">✦</span>
                <span className={styles.ugcCtaContent}>
                  <span className={styles.ugcCtaTitle}>
                    {submitting ? 'Starting…' : ctaIdleLabel}
                  </span>
                  {/* Per-generation credit cost intentionally hidden */}
                </span>
              </button>
            );
          })()}

          {nextSceneType === 'new' && storyScenes.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setStep('result')}
                className={styles.ugcSecondaryLink}
              >
                ← Back to scenes
              </button>
            </div>
          )}

          <div className={styles.ugcFootNote}>
            <span aria-hidden="true">🔒</span>
            <span>Your videos are private and secure</span>
          </div>

          {/* UGC-3: credits-remaining badge intentionally hidden */}
        </form>
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode="signup"
        redirectTo="/real-estate"
      />
    </>
  );
}
