import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import JobHistory from '../components/JobHistory';
import UploadGuide from '../components/UploadGuide';
import Paywall from '../components/Paywall';
import HybridPreview from '../components/HybridPreview';
import { uploadTempFile } from '../lib/uploader';
import { extractFirstFrame } from '../lib/frameExtract';
import { log } from '../lib/debugLog';

export default function Home({ activeTab, onTabChange }) {
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
  const [previewBusy, setPreviewBusy] = useState(null); // 'regen' | 'proceed' | null
  // URLs persist across upload -> preview -> processing transitions.
  const [uploadedUrls, setUploadedUrls] = useState({
    sourceVideoUrl: null,
    sourceFrameUrl: null,
    referenceImageUrl: null,
    hybridFrameUrl: null,
  });
  const pendingSwapRef = useRef(false);
  const paRetryRef = useRef(false);

  const canSubmit = Boolean(videoFile && faceFile && consent && !submitting);

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
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const paid = params.get('paid');

    (async () => {
      if (paid === '1' && sessionId) {
        try {
          const res = await fetch(`/api/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`, {
            method: 'POST',
          });
          const data = await res.json();
          log(res.ok ? 'info' : 'error', 'checkout confirm', data);
          if (res.ok) setPaidBanner(true);
        } catch (err) {
          log('error', 'checkout confirm threw', { message: err.message });
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('paid');
        url.searchParams.delete('session_id');
        window.history.replaceState({}, '', url.toString());
      }
      await fetchEntitlement();
    })();
  }, [fetchEntitlement]);

  const reset = useCallback(() => {
    setStep('upload');
    setVideoFile(null);
    setFaceFile(null);
    setConsent(false);
    setError('');
    setSubmitting(false);
    setActiveJob(null);
    setUploadedUrls({
      sourceVideoUrl: null,
      sourceFrameUrl: null,
      referenceImageUrl: null,
      hybridFrameUrl: null,
    });
  }, []);

  // Stage 1: extract first frame, upload everything, ask Banana for hybrid frame.
  const runBananaPrep = useCallback(async () => {
    if (!videoFile || !faceFile) return false;
    setError('');
    setSubmitting(true);
    try {
      log('info', 'extracting first frame', { name: videoFile.name });
      const frameFile = await extractFirstFrame(videoFile);
      log('info', 'frame extracted', { size: frameFile.size });

      const [sourceVideoUrl, sourceFrameUrl, referenceImageUrl] = await Promise.all([
        uploadTempFile(videoFile),
        uploadTempFile(frameFile),
        uploadTempFile(faceFile),
      ]);

      log('info', 'banana request', { sourceFrameUrl, referenceImageUrl });
      const res = await fetch('/api/banana-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstFrameUrl: sourceFrameUrl, referenceImageUrl }),
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
      });
      setStep('preview');
      return true;
    } catch (err) {
      log('error', 'banana prep failed', { message: err.message });
      setError(err.message || 'Something went wrong while generating the preview.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [videoFile, faceFile, fetchEntitlement]);

  // Regenerate just the Banana hybrid frame using the already-uploaded URLs.
  const regenerateHybrid = useCallback(async () => {
    const { sourceFrameUrl, referenceImageUrl } = uploadedUrls;
    if (!sourceFrameUrl || !referenceImageUrl) return;
    setPreviewBusy('regen');
    setError('');
    try {
      log('info', 'banana regen request', { sourceFrameUrl, referenceImageUrl });
      const res = await fetch('/api/banana-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstFrameUrl: sourceFrameUrl, referenceImageUrl }),
      });
      const data = await res.json().catch(() => ({}));
      log(res.ok ? 'info' : 'warn', 'banana regen response', {
        httpStatus: res.status,
        body: data,
      });
      if (!res.ok || !data.hybridFrameUrl) {
        throw new Error(data.error || 'Regeneration failed.');
      }
      setUploadedUrls((prev) => ({ ...prev, hybridFrameUrl: data.hybridFrameUrl }));
    } catch (err) {
      log('error', 'banana regen failed', { message: err.message });
      setError(err.message || 'Regeneration failed.');
    } finally {
      setPreviewBusy(null);
    }
  }, [uploadedUrls]);

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
    });

    const ent = entitlement || (await fetchEntitlement());
    if (!ent || !ent.canSwap) {
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
        log('warn', 'PA error \u2014 auto-retrying once', { message });
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

  if (activeTab === 'history') {
    return (
      <main className={styles.page}>
        <JobHistory />
      </main>
    );
  }

  if (step === 'paywall') {
    return (
      <main className={styles.page}>
        <Paywall
          entitlement={entitlement}
          onTrialStarted={handleTrialStarted}
          onError={(msg) => setError(msg)}
        />
      </main>
    );
  }

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
          onRegenerate={regenerateHybrid}
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

  if (step === 'result' && activeJob) {
    return (
      <main className={styles.page}>
        <Result
          job={activeJob}
          onNewSwap={() => {
            reset();
            onTabChange && onTabChange('create');
          }}
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <span className={styles.eyebrow}>\u25c6 AI Face Swap</span>
        <h1 className={styles.headline}>
          Swap any face into <span className={styles.accent}>any video</span>
        </h1>
        <p className={styles.subtitle}>
          Two-stage pipeline: Nano Banana Pro composes your character into the first frame, then Kling 3.0 motion control animates it through the rest of the clip.
        </p>
      </div>

      {paidBanner && (
        <div className={styles.banner}>
          \u25c6 You're subscribed. Upload your files to start swapping.
        </div>
      )}

      <UploadGuide />

      <form className={styles.shell} onSubmit={handleSubmit}>
        <div className={styles.uploads}>
          <UploadZone
            label="Source video"
            sublabel="MP4 or MOV \u00b7 3\u201330s \u00b7 Max 100MB"
            icon="\ud83c\udfac"
            accept="video/mp4,video/quicktime"
            file={videoFile}
            onFileSelected={setVideoFile}
            onRemove={() => setVideoFile(null)}
          />
          <UploadZone
            label="Reference face"
            sublabel="JPG or PNG \u00b7 Clear, front-facing"
            icon="\ud83d\udc64"
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
            <span className={styles.modeDetail}>720p \u00b7 faster</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'pro'}
            className={`${styles.modeBtn} ${mode === 'pro' ? styles.modeBtnActive : ''}`}
            onClick={() => setMode('pro')}
          >
            <span className={styles.modeName}>Pro</span>
            <span className={styles.modeDetail}>1080p \u00b7 sharper</span>
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
            \u2713
          </span>
          <span className={styles.consentText}>
            I have consent to use this likeness.
            <span className={styles.consentDetail}>
              Misuse \u2014 including impersonation, harassment, or non-consensual content \u2014 results in
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
          {submitting ? 'Generating preview\u2026' : 'Create face swap'}
        </button>

        {entitlement && entitlement.canSwap && (
          <div className={styles.usage}>
            {entitlement.tier === 'trial'
              ? `Free trial: ${entitlement.videosUsed}/${entitlement.videoCap} swaps used`
              : `${entitlement.tier === 'monthly' ? 'Monthly' : 'Yearly'} plan: ${entitlement.videosUsed}/${entitlement.videoCap} swaps used`}
          </div>
        )}

        <div className={styles.footerRow}>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>\u25c6</span> Encrypted upload
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>\u25c6</span> Two-stage pipeline
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>\u25c6</span> Auto-deleted in 7 days
          </span>
        </div>
      </form>
    </main>
  );
}
