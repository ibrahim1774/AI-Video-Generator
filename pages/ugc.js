import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { useRouter } from 'next/router';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Paywall from '../components/Paywall';
import AuthModal from '../components/AuthModal';
import DurationSlider, {
  costForDuration,
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

const FEATURE = 'ugc';
const MAX_SCENES = 5;

// Wistia media IDs and aspect ratios for the four marketing demos
// shown to anonymous visitors on /ugc. All are vertical (9:16-ish).
const LANDING_VIDEOS = [
  { id: '85rijpwaq2', aspect: 0.5625 },
  { id: 'lnndmek1c5', aspect: 0.5598755832037325 },
  { id: 'lsno8w6lt4', aspect: 0.5598755832037325 },
  { id: 'nx8bxwnoiw', aspect: 0.5581395348837209 },
  { id: 'clq4ug7ln2', aspect: 0.5642633228840125 },
  { id: 'p68dfq0341', aspect: 0.5642633228840125 },
];

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

export default function UgcPage() {
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

  const cost = costForDuration(duration, model, resolution, audio);
  const storyScenes = story?.scenes || [];
  const latestScene = storyScenes[storyScenes.length - 1] || null;
  const atSceneCap = storyScenes.length >= MAX_SCENES;

  const handleUpload = async (file) => {
    // Anonymous visitor: intercept BEFORE the file is compressed or
    // uploaded so we don't touch their photo. Open the auth modal; once
    // they finish sign-up, AuthModal redirects back to /ugc and they can
    // re-attach the image.
    if (!authUser) {
      setAuthModalOpen(true);
      return;
    }
    setUploadFile(file);
    setError('');
    setImageBusy('upload');
    try {
      const compressed = await maybeCompressImage(file);
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
    if (!effectiveStartImage || submitting) return;
    if (!authUser) {
      setAuthModalOpen(true);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/ugc-animate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: effectiveStartImage,
          script,
          duration,
          model,
          resolution,
          audio,
        }),
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
        <div className={styles.hero}>
          <p className={styles.subtitle} style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Loading…</p>
        </div>
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
            <span className={styles.eyebrow}>◆ Pick a plan</span>
            <h1 className={styles.headline}>Start creating AI videos</h1>
          </div>
          <Paywall
            entitlement={entitlement}
            returnTo="/ugc"
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
          <span className={styles.eyebrow}>◆ Extending</span>
          <h1 className={styles.headline}>
            Reading the <em className={styles.accent}>last frame</em>
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
          <span className={styles.eyebrow}>◆ Combining</span>
          <h1 className={styles.headline}>
            Stitching your <em className={styles.accent}>scenes together</em>
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
          <span className={styles.eyebrow}>◆ Done</span>
          <h1 className={styles.headline}>
            Your story is <em className={styles.accent}>ready</em>
          </h1>
          <p className={styles.subtitle}>
            {storyScenes.length} scenes combined into one video.
          </p>
        </div>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px', width: '100%' }}>
          {/* Video in a glass frame */}
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-2xl)',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09), var(--shadow-xl)',
            background: '#000',
          }}>
            <video
              src={story.combinedUrl}
              controls
              style={{ width: '100%', display: 'block' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => triggerDownload(story.combinedUrl, 'ariyalab-story.mp4')}
              className="btn-primary"
              style={{ flex: 2, minWidth: 200, justifyContent: 'center' }}
            >
              ↓ Download combined
            </button>
            <button
              type="button"
              onClick={() => setStep('result')}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 140, justifyContent: 'center' }}
            >
              ← Back to scenes
            </button>
            <button
              type="button"
              onClick={resetStory}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 140, justifyContent: 'center' }}
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
          <span className={styles.eyebrow}>
            ◆ Scene {storyScenes.length} of {MAX_SCENES} &middot; saved
          </span>
          <h1 className={styles.headline}>
            Your scene is <em className={styles.accent}>ready</em>
          </h1>
        </div>

        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px', width: '100%' }}>
          {/* Latest scene video — glass frame */}
          <div style={{
            position: 'relative',
            borderRadius: 'var(--radius-2xl)',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09), var(--shadow-xl)',
            background: '#000',
          }}>
            <video
              key={featured?.id}
              src={featured?.videoUrl}
              controls
              style={{ width: '100%', display: 'block' }}
            />
          </div>

          {/* Story rail */}
          {storyScenes.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 14,
                overflowX: 'auto',
                padding: '4px 0 4px',
                scrollbarWidth: 'none',
              }}
            >
              {storyScenes.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    flex: '0 0 auto',
                    width: 116,
                    position: 'relative',
                    border: `1px solid ${s.id === featured.id ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.09)'}`,
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    background: 'var(--surface-1)',
                    boxShadow: s.id === featured.id
                      ? 'inset 0 1px 0 rgba(255,255,255,0.12), var(--shadow-md)'
                      : 'var(--shadow-sm)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.startImageUrl}
                    alt={`Scene ${i + 1}`}
                    style={{ width: '100%', height: 78, objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{
                    padding: '5px 8px',
                    fontSize: 10,
                    color: s.id === featured.id ? 'var(--text-dim)' : 'var(--text-faint)',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    S{i + 1} · {s.duration}s {s.type === 'extend' ? '↪' : s.type === 'new' ? '+' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className={styles.error} style={{ marginTop: 14 }}>{error}</div>}

          {/* Audio notice */}
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 'var(--radius-md)',
            fontSize: 11,
            color: 'var(--text-faint)',
            lineHeight: 1.55,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            Each scene generates its own audio track — voice &amp; ambient sound change at seams.
          </div>

          {/* Primary actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            <button
              type="button"
              onClick={handleExtend}
              disabled={atSceneCap}
              className="btn-primary"
              style={atSceneCap ? { opacity: 0.38, cursor: 'not-allowed', justifyContent: 'center' } : { justifyContent: 'center' }}
            >
              ↪ Extend scene
            </button>
            <button
              type="button"
              onClick={handleNewScene}
              disabled={atSceneCap}
              className="btn-ghost"
              style={{
                justifyContent: 'center',
                opacity: atSceneCap ? 0.38 : 1,
                cursor: atSceneCap ? 'not-allowed' : 'pointer',
              }}
            >
              + New scene
            </button>
          </div>

          {atSceneCap && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              5-scene cap reached — combine or start a new story.
            </div>
          )}

          {/* Secondary actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
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
              style={{ flex: 1, minWidth: 130, justifyContent: 'center' }}
            >
              ↓ Scene {storyScenes.length}
            </button>
            {storyScenes.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="btn-ghost"
                style={{ flex: 1, minWidth: 110, justifyContent: 'center' }}
              >
                ⌫ Undo last
              </button>
            )}
            <button
              type="button"
              onClick={resetStory}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 110, justifyContent: 'center' }}
            >
              + New story
            </button>
          </div>

          {entitlement && entitlement.canSwap && (
            <div className={styles.usage} style={{ marginTop: 16 }}>
              {entitlement.creditsRemaining} credit
              {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
            </div>
          )}
        </div>
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
          returnTo="/ugc"
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
    maxWidth: 680,
    width: 'calc(100% - 32px)',
    margin: '12px auto 20px',
    padding: '12px 18px',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 'var(--radius-lg)',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
    color: 'var(--text-dim)',
    fontSize: 12,
    lineHeight: 1.55,
    textAlign: 'center',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
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
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1 className={styles.headline}>
              Tell your character what to <em className={styles.accent}>do and say</em>
            </h1>
          </div>

          <div style={calloutStyle}>
            ◆ Powered by Kling 3.0 — <strong>3&ndash;15 seconds</strong> per scene with
            optional native audio. <strong>1 credit per second</strong> of video.
            Generation takes 2&ndash;4 minutes.
          </div>

          <form className={styles.shell} onSubmit={handleAnimate}>
            {/* Starting frame — glass preview */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{
                position: 'relative',
                borderRadius: 'var(--radius-xl)',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09), var(--shadow-lg)',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={effectiveStartImage}
                  alt="Starting frame"
                  style={{ maxWidth: 300, maxHeight: 300, display: 'block' }}
                />
              </div>
            </div>

            <label style={{ display: 'block' }}>
              <span className={styles.swapModeLabel} style={{ display: 'block', marginBottom: 8 }}>Script / direction</span>
              <div className={styles.ugcTextareaWrap}>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={4}
                  placeholder='e.g. Smiles and waves at the camera, then says: "Hey everyone, today I am reviewing my favorite coffee."'
                  className={styles.ugcTextarea}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Tip: put dialogue in &ldquo;quotes&rdquo; so the model lip-syncs it.
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
              {submitting ? 'Starting…' : `Generate (${cost} credit${cost === 1 ? '' : 's'})`}
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

            {entitlement && entitlement.canSwap && (
              <div className={styles.usage}>
                {entitlement.creditsRemaining} credit
                {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
              </div>
            )}
          </form>
        </main>

        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          initialMode="signup"
          redirectTo="/ugc"
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
      <Head><title>From a Single Image to a Full Video — Ariya Lab</title></Head>
      <main className={styles.page} style={{ paddingTop: 8 }}>
        <div className={styles.hero} style={{ marginBottom: 10 }}>
          <span className={styles.eyebrow}>◆ UGC Creator</span>
          <h1
            className={styles.headline}
            style={{ fontSize: 'clamp(32px, 5.5vw, 58px)', margin: '18px 0 0', lineHeight: 1.06 }}
          >
            Turn Any Image Into a{' '}
            <em className="shimmer-text" style={{ fontStyle: 'italic' }}>
              Talking Video
            </em>
          </h1>
          <p className={styles.subtitle} style={{ marginTop: 12, fontSize: 15 }}>
            Upload your character, write the script — Ariya Lab animates it in minutes.
          </p>
        </div>

        <form onSubmit={handleAnimate} className={styles.ugcCard}>
          {/* 1. Add your character */}
          <section className={styles.ugcSection}>
            <h3 className={styles.ugcSectionTitle} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 500 }}>01 — Add your character</h3>
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

          {/* 2. Script */}
          <section className={styles.ugcSection}>
            <h3 className={styles.ugcSectionTitle} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 500 }}>02 — Script &amp; direction</h3>
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
            <h3 className={styles.ugcSectionTitle} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-faint)', fontWeight: 500 }}>03 — Video length</h3>
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
                        padding: '13px 10px',
                        borderRadius: 'var(--radius-md)',
                        border: selected
                          ? '1px solid rgba(255,255,255,0.5)'
                          : '1px solid rgba(255,255,255,0.08)',
                        background: selected
                          ? 'linear-gradient(180deg, #ffffff 0%, #d4d4da 100%)'
                          : 'rgba(255,255,255,0.03)',
                        boxShadow: selected
                          ? 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.1), 0 6px 18px -8px rgba(255,255,255,0.28)'
                          : 'none',
                        color: selected ? '#0a0a0b' : 'var(--text-dim)',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: selected ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'background 140ms var(--ease), color 140ms var(--ease), box-shadow 200ms var(--ease)',
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

          <button
            type="submit"
            className={`${styles.ugcCta} ${(!effectiveStartImage || submitting) ? styles.ugcCtaDisabled : ''}`}
            disabled={!effectiveStartImage || submitting}
          >
            {submitting && <span className={styles.spinner} aria-hidden="true" />}
            <span className={styles.ugcCtaIcon} aria-hidden="true">✦</span>
            <span className={styles.ugcCtaContent}>
              <span className={styles.ugcCtaTitle}>
                {submitting
                  ? 'Starting…'
                  : effectiveStartImage
                    ? 'Generate video'
                    : 'Upload an image to continue'}
              </span>
              {effectiveStartImage && !submitting && (
                <span className={styles.ugcCtaSub}>Uses {cost} credit{cost === 1 ? '' : 's'}</span>
              )}
            </span>
          </button>

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

          <div className={styles.ugcFootNote} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            <span aria-hidden="true" style={{ fontSize: 11 }}>◆</span>
            <span>Your videos are private and secure</span>
          </div>

          {entitlement && entitlement.canSwap && (
            <div className={styles.usage} style={{ marginTop: 8 }}>
              {entitlement.creditsRemaining} credit
              {entitlement.creditsRemaining === 1 ? '' : 's'} remaining
            </div>
          )}
        </form>

        <Script src="https://fast.wistia.com/player.js" strategy="afterInteractive" async />
        {LANDING_VIDEOS.slice(0, 4).map((v) => (
          <Script
            key={v.id}
            src={`https://fast.wistia.com/embed/${v.id}.js`}
            strategy="afterInteractive"
            type="module"
            async
          />
        ))}

        <div className="ugc-creator-carousel-wrap">
          <div className="ugc-creator-carousel" role="region" aria-label="UGC examples">
            {LANDING_VIDEOS.slice(0, 4).map((v) => (
              <div key={v.id} className="ugc-creator-carousel-card">
                <wistia-player
                  media-id={v.id}
                  aspect={String(v.aspect)}
                  autoplay="true"
                  muted="true"
                  silentautoplay="true"
                  playsinline="true"
                  controls-visible-on-load="false"
                  playbar="false"
                  playbutton="false"
                  volume-control="false"
                  fullscreen-button="false"
                  settings-control="false"
                  endvideobehavior="loop"
                />
              </div>
            ))}
          </div>
        </div>

        <style jsx global>{`
          .ugc-creator-carousel-wrap {
            max-width: 100%;
            margin: 32px auto 12px;
            padding: 0;
          }
          .ugc-creator-carousel {
            display: flex;
            gap: 12px;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            scroll-padding: 0 16px;
            padding: 8px 16px 14px;
            scrollbar-width: none;
          }
          .ugc-creator-carousel::-webkit-scrollbar { display: none; }
          .ugc-creator-carousel-card {
            position: relative;
            flex: 0 0 auto;
            width: clamp(160px, 60vw, 200px);
            border-radius: 18px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: #09090b;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.08),
              0 12px 36px -12px rgba(0, 0, 0, 0.65),
              0 4px 12px rgba(0, 0, 0, 0.35);
            scroll-snap-align: center;
            min-width: 0;
            transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s ease;
          }
          .ugc-creator-carousel-card::before {
            content: '';
            position: absolute;
            inset: 0 0 auto 0;
            height: 36%;
            border-radius: 18px 18px 0 0;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent);
            pointer-events: none;
            z-index: 1;
          }
          .ugc-creator-carousel-card:hover {
            transform: translateY(-3px) scale(1.012);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.1),
              0 20px 52px -14px rgba(0, 0, 0, 0.75),
              0 6px 16px rgba(0, 0, 0, 0.4);
          }
          .ugc-creator-carousel-card wistia-player {
            display: block;
            width: 100%;
            max-width: 100%;
          }
          @media (min-width: 720px) {
            .ugc-creator-carousel {
              justify-content: center;
              scroll-padding: 0;
              padding: 8px 24px 14px;
            }
            .ugc-creator-carousel-card { width: 182px; }
          }
        `}</style>
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode="signup"
        redirectTo="/ugc"
      />
    </>
  );
}
