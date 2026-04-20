import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import UploadGuide from '../components/UploadGuide';
import Paywall from '../components/Paywall';
import HybridPreview from '../components/HybridPreview';
import AuthModal from '../components/AuthModal';
import { uploadTempFile } from '../lib/uploader';
import { extractFirstFrame } from '../lib/frameExtract';
import { log } from '../lib/debugLog';
import { getBrowserSupabase } from '../lib/supabase';

export default function Home() {
  const [step, setStep] = useState('upload');
  const [videoFile, setVideoFile] = useState(null);
  const [faceFile, setFaceFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [entitlement, setEntitlement] = useState(null);
  const [paidBanner, setPaidBanner] = useState(false);
  const [mode, setMode] = useState('std');
  const [swapMode, setSwapMode] = useState(null); // 'face' | 'body' — no default
  const [previewBusy, setPreviewBusy] = useState(null); // 'regen' | 'proceed' | null
  // URLs persist across upload -> preview -> processing transitions.
  const [uploadedUrls, setUploadedUrls] = useState({
    sourceVideoUrl: null,
    sourceFrameUrl: null,
    referenceImageUrl: null,
    hybridFrameUrl: null,
    swapMode: null,
  });
  const pendingSwapRef = useRef(false);
  const paRetryRef = useRef(false);
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  const canSubmit = Boolean(videoFile && faceFile && consent && swapMode && !submitting);

  const fetchEntitlement = useCallback(async () => {
    try {
      const res = await fetch('/api/entitlement');
      const data = await res.json();
      setEntitlement(data);
      log('info', 'entitlement', data);
      return data;
    } catch (err) {
      log('error', 'entitlement fetch failed', { message: err.message });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!authLoaded || !authUser) return;
    fetchEntitlement();
  }, [authLoaded, authUser, fetchEntitlement]);

  const reset = useCallback(() => {
    setStep('upload');
    setVideoFile(null);
    setFaceFile(null);
    setConsent(false);
    setError('');
    setSubmitting(false);
    setActiveJob(null);
    setSwapMode(null);
    setUploadedUrls({
      sourceVideoUrl: null,
      sourceFrameUrl: null,
      referenceImageUrl: null,
      hybridFrameUrl: null,
      swapMode: null,
    });
  }, []);

  // Stage 1: extract first frame, upload everything, ask Banana for hybrid frame.
  const runBananaPrep = useCallback(async () => {
    if (!videoFile || !faceFile) return false;
    setError('');
    setSubmitting(true);
    try {
      log('info', 'extracting first frame (browser)', { name: videoFile.name });
      let frameFile = null;
      let needsServerFallback = false;
      try {
        frameFile = await extractFirstFrame(videoFile);
        log('info', 'frame extracted (browser)', { size: frameFile.size });
      } catch (err) {
        if (err && err.code === 'BROWSER_DECODE_FAILED') {
          log('warn', 'browser decode failed — will use server ffmpeg', {
            message: err.message,
          });
          needsServerFallback = true;
        } else {
          throw err;
        }
      }

      // Always upload the source video and reference image. The frame
      // is either uploaded from the browser (fast path) or generated
      // server-side from the source URL (codec fallback).
      const uploadPromises = [uploadTempFile(videoFile), uploadTempFile(faceFile)];
      if (frameFile) uploadPromises.push(uploadTempFile(frameFile));
      const uploaded = await Promise.all(uploadPromises);
      const sourceVideoUrl = uploaded[0];
      const referenceImageUrl = uploaded[1];
      let sourceFrameUrl = uploaded[2] || null;

      if (needsServerFallback) {
        log('info', 'extract-frame request', { sourceVideoUrl });
        const fr = await fetch('/api/extract-frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: sourceVideoUrl }),
        });
        const fdata = await fr.json().catch(() => ({}));
        log(fr.ok ? 'info' : 'error', 'extract-frame response', {
          httpStatus: fr.status,
          body: fdata,
        });
        if (!fr.ok || !fdata.frameUrl) {
          throw new Error(
            fdata.error ||
              'Server could not extract a first frame from this video.'
          );
        }
        sourceFrameUrl = fdata.frameUrl;
      }

      log('info', 'banana request', { sourceFrameUrl, referenceImageUrl, swapMode });
      const res = await fetch('/api/banana-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstFrameUrl: sourceFrameUrl, referenceImageUrl, swapMode }),
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        log('error', 'banana response not JSON', {
          httpStatus: res.status,
          bodyPreview: rawText.slice(0, 300),
        });
        throw new Error(`Server returned non-JSON (${res.status})`);
      }
      log(res.ok ? 'info' : 'warn', 'banana response', { httpStatus: res.status, body: data });

      if (res.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return false;
      }
      if (!res.ok || !data.hybridFrameUrl) {
        throw new Error(data.error || 'Hybrid frame generation failed.');
      }

      setUploadedUrls({
        sourceVideoUrl,
        sourceFrameUrl,
        referenceImageUrl,
        hybridFrameUrl: data.hybridFrameUrl,
        swapMode,
      });
      // Banana just consumed a slot — refresh the counter in the UI.
      fetchEntitlement();
      setStep('preview');
      return true;
    } catch (err) {
      log('error', 'banana prep failed', { message: err.message });
      setError(err.message || 'Something went wrong while generating the preview.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [videoFile, faceFile, swapMode, fetchEntitlement]);

  // Stage 2: kick off Kling using the approved hybrid frame + original source video.
  const proceedWithSwap = useCallback(async () => {
    const { sourceVideoUrl, hybridFrameUrl } = uploadedUrls;
    if (!sourceVideoUrl || !hybridFrameUrl) return;
    setPreviewBusy('proceed');
    setError('');
    try {
      log('info', 'swap request', { videoUrl: sourceVideoUrl, imageUrl: hybridFrameUrl, mode });
      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: sourceVideoUrl,
          imageUrl: hybridFrameUrl,
          mode,
          videoFileName: videoFile?.name || 'source.mp4',
          faceFileName: faceFile?.name || 'character.jpg',
        }),
      });
      const data = await res.json().catch(() => ({}));
      log(res.ok ? 'info' : 'warn', 'swap response', { httpStatus: res.status, body: data });

      if (res.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start the swap.');
      }

      setActiveJob({
        jobId: data.jobId,
        predictionId: data.predictionId,
        status: data.status,
        videoFileName: videoFile?.name,
        faceFileName: faceFile?.name,
      });
      setStep('processing');
      paRetryRef.current = false;
      fetchEntitlement();
    } catch (err) {
      log('error', 'swap failed', { message: err.message });
      setError(err.message || 'Something went wrong.');
    } finally {
      setPreviewBusy(null);
    }
  }, [uploadedUrls, mode, videoFile, faceFile, fetchEntitlement]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    log('info', 'submit click', {
      videoName: videoFile?.name,
      videoSize: videoFile?.size,
      faceName: faceFile?.name,
      faceSize: faceFile?.size,
      authed: Boolean(authUser),
    });

    const ent = entitlement || (await fetchEntitlement());
    if (!ent || !ent.canSwap) {
      // Signed-in but no credits — show inline paywall; files stay in state.
      pendingSwapRef.current = true;
      setStep('paywall');
      return;
    }
    await runBananaPrep();
  };

  const handleTrialStarted = useCallback(async () => {
    setPaidBanner(false);
    const ent = await fetchEntitlement();
    if (ent && ent.canSwap && pendingSwapRef.current) {
      pendingSwapRef.current = false;
      setStep('upload');
      setTimeout(() => runBananaPrep(), 0);
    } else {
      setStep('upload');
    }
  }, [fetchEntitlement, runBananaPrep]);

  const handleComplete = useCallback((job) => {
    setActiveJob((prev) => ({ ...(prev || {}), ...job }));
    setStep('result');
  }, []);

  const handleError = useCallback(
    (message) => {
      const isPa =
        typeof message === 'string' && /\bPA\b|prediction interrupted/i.test(message);
      if (isPa && !paRetryRef.current) {
        paRetryRef.current = true;
        log('warn', 'PA error — auto-retrying once', { message });
        setError('');
        setTimeout(() => proceedWithSwap(), 0);
        return;
      }
      paRetryRef.current = false;
      setError(message);
      setStep('preview'); // back to preview so user can retry without re-uploading
    },
    [proceedWithSwap]
  );

  if (step === 'preview') {
    return (
      <main className={styles.page}>
        {error && <div className={styles.error}>{error}</div>}
        <HybridPreview
          hybridFrameUrl={uploadedUrls.hybridFrameUrl}
          sourceFrameUrl={uploadedUrls.sourceFrameUrl}
          referenceImageUrl={uploadedUrls.referenceImageUrl}
          busy={previewBusy}
          onProceed={proceedWithSwap}
          onCancel={reset}
        />
      </main>
    );
  }

  if (step === 'processing' && activeJob) {
    return (
      <main className={styles.page}>
        <Processing
          predictionId={activeJob.predictionId}
          onComplete={handleComplete}
          onError={handleError}
        />
      </main>
    );
  }

  if (step === 'paywall') {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ Pick a plan</span>
          <h1 className={styles.headline}>
            One step to <span className={styles.accent}>finish your swap</span>
          </h1>
          <p className={styles.subtitle}>
            Your files are ready. Choose a plan and we’ll run the swap right after.
          </p>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <Paywall
          entitlement={entitlement}
          onError={(msg) => setError(msg)}
          onTrialStarted={handleTrialStarted}
        />
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setStep('upload')}
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
            ← Back to upload
          </button>
        </div>
      </main>
    );
  }

  if (step === 'result' && activeJob) {
    return (
      <main className={styles.page}>
        <Result
          job={activeJob}
          onNewSwap={reset}
        />
      </main>
    );
  }

  if (authLoaded && !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>◆ AI Face Swap</span>
          <h1 className={styles.headline}>
            Swap any face into <span className={styles.accent}>any video</span>
          </h1>
          <p className={styles.subtitle}>
            We use our top-rated models to turn your photo and video into one new clip. First we paint your face into the very first frame of your source video. Then we teach that frame how to move &mdash; every blink, head turn, and expression flows onto your new face.
          </p>
        </div>
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className={`${styles.submit} ${styles.submitReady}`}
            style={{ maxWidth: 320, margin: '0 auto' }}
          >
            Sign up to start →
          </button>
          <p className={styles.subtitle} style={{ marginTop: 16, fontSize: 13 }}>
            Already have an account?{' '}
            <a href="/sign-in" style={{ color: '#e0c488' }}>
              Sign in
            </a>
          </p>
        </div>
        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          initialMode="signup"
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>◆ AI Face Swap</span>
        <h1 className={styles.headline}>
          Swap any face into <span className={styles.accent}>any video</span>
        </h1>
        <p className={styles.subtitle}>
          Two-stage pipeline: Nano Banana Pro composes your character into the first frame, then Kling 3.0 motion control animates it through the rest of the clip.
        </p>
      </div>

      {paidBanner && (
        <div className={styles.banner}>
          ◆ You're subscribed. Upload your files to start swapping.
        </div>
      )}

      <UploadGuide />

      <div
        style={{
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
        }}
      >
        ◆ Heads-up: every swap runs on our most powerful (and most expensive)
        AI models. That's why the result looks studio-clean &mdash; and why
        each generation takes <strong>2&ndash;4 minutes</strong> after you
        click below.
      </div>

      <form className={styles.shell} onSubmit={handleSubmit}>
        <div className={styles.uploads}>
          <UploadZone
            label="Source video"
            sublabel="MP4 or MOV · 3–30s · Max 100MB"
            icon="🎬"
            accept="video/mp4,video/quicktime"
            file={videoFile}
            onFileSelected={setVideoFile}
            onRemove={() => setVideoFile(null)}
          />
          <UploadZone
            label="Reference face"
            sublabel="JPG or PNG · Clear, front-facing"
            icon="👤"
            accept="image/jpeg,image/png"
            file={faceFile}
            onFileSelected={setFaceFile}
            onRemove={() => setFaceFile(null)}
          />
        </div>

        <div className={styles.modeRow} role="radiogroup" aria-label="Output quality">
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

        <div className={styles.swapModeLabel}>
          Swap mode <span className={styles.required}>(required)</span>
        </div>
        <div className={styles.modeRow} role="radiogroup" aria-label="Swap mode">
          <button
            type="button"
            role="radio"
            aria-checked={swapMode === 'face'}
            className={`${styles.modeBtn} ${swapMode === 'face' ? styles.modeBtnActive : ''}`}
            onClick={() => setSwapMode('face')}
          >
            <span className={styles.modeName}>Face swap</span>
            <span className={styles.modeDetail}>Keep source body + scene, swap only the face</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={swapMode === 'body'}
            className={`${styles.modeBtn} ${swapMode === 'body' ? styles.modeBtnActive : ''}`}
            onClick={() => setSwapMode('body')}
          >
            <span className={styles.modeName}>Full body swap</span>
            <span className={styles.modeDetail}>Replace whole character, keep source pose + scene</span>
          </button>
        </div>

        <label
          className={`${styles.consent} ${consent ? styles.consentActive : ''}`}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          />
          <span
            className={`${styles.checkbox} ${consent ? styles.checkboxOn : ''}`}
            aria-hidden="true"
          >
            ✓
          </span>
          <span className={styles.consentText}>
            I have consent to use this likeness.
            <span className={styles.consentDetail}>
              Misuse — including impersonation, harassment, or non-consensual content — results in
              immediate termination.
            </span>
          </span>
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button
          type="submit"
          className={`${styles.submit} ${canSubmit ? styles.submitReady : ''} ${
            submitting ? styles.submitLoading : ''
          }`}
          disabled={!canSubmit}
        >
          {submitting && <span className={styles.spinner} aria-hidden="true" />}
          {submitting ? 'Generating preview…' : 'Create face swap'}
        </button>

        {entitlement && entitlement.canSwap && (
          <div className={styles.usage}>
            {entitlement.status === 'trialing'
              ? `Free trial — ${entitlement.creditsRemaining} credit${entitlement.creditsRemaining === 1 ? '' : 's'} remaining`
              : `${entitlement.tier === 'monthly' ? 'Monthly' : 'Yearly'} plan — ${entitlement.creditsRemaining} credits remaining`}
          </div>
        )}

        <div className={styles.footerRow}>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>◆</span> Encrypted upload
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>◆</span> Two-stage pipeline
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>◆</span> Auto-deleted in 7 days
          </span>
        </div>
      </form>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode="signup"
      />
    </main>
  );
}
