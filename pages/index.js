import { useCallback, useEffect, useRef, useState } from 'react';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import JobHistory from '../components/JobHistory';
import UploadGuide from '../components/UploadGuide';
import Paywall from '../components/Paywall';
import { uploadTempFile } from '../lib/uploader';
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
  const pendingSwapRef = useRef(false);

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

  // Initial entitlement check + handle Stripe Checkout return.
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
        // strip query string so refresh doesn't re-confirm
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
  }, []);

  // Run the actual swap with the currently-selected files. Returns true on success.
  const runSwap = useCallback(async () => {
    if (!videoFile || !faceFile) return false;
    setError('');
    setSubmitting(true);
    try {
      log('info', 'swap start', {
        videoName: videoFile.name,
        videoSize: videoFile.size,
        faceName: faceFile.name,
        faceSize: faceFile.size,
      });

      const [videoUrl, faceUrl] = await Promise.all([
        uploadTempFile(videoFile),
        uploadTempFile(faceFile),
      ]);

      log('info', 'swap request', { videoUrl, faceUrl });
      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          faceUrl,
          videoFileName: videoFile.name,
          faceFileName: faceFile.name,
        }),
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        log('error', 'swap response not JSON', {
          httpStatus: res.status,
          bodyPreview: rawText.slice(0, 300),
        });
        throw new Error(`Server returned non-JSON (${res.status})`);
      }
      log(res.ok ? 'info' : 'warn', 'swap response', { httpStatus: res.status, body: data });

      // Paywall trip — server says no entitlement.
      if (res.status === 402) {
        await fetchEntitlement();
        setStep('paywall');
        return false;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start face swap.');
      }

      setActiveJob({
        jobId: data.jobId,
        predictionId: data.predictionId,
        status: data.status,
        videoFileName: videoFile.name,
        faceFileName: faceFile.name,
      });
      setStep('processing');
      // Refresh entitlement so the next click reflects the new usage count.
      fetchEntitlement();
      return true;
    } catch (err) {
      log('error', 'swap failed', { message: err.message });
      setError(err.message || 'Something went wrong.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [videoFile, faceFile, fetchEntitlement]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    // Look up entitlement up-front so we can show the paywall before
    // burning the user's bandwidth uploading.
    const ent = entitlement || (await fetchEntitlement());
    if (!ent || !ent.canSwap) {
      pendingSwapRef.current = true;
      setStep('paywall');
      return;
    }
    await runSwap();
  };

  const handleTrialStarted = useCallback(async () => {
    setPaidBanner(false);
    const ent = await fetchEntitlement();
    if (ent && ent.canSwap && pendingSwapRef.current) {
      pendingSwapRef.current = false;
      setStep('upload');
      // give React a tick to render upload step before kicking off swap UI
      setTimeout(() => runSwap(), 0);
    } else {
      setStep('upload');
    }
  }, [fetchEntitlement, runSwap]);

  const handleComplete = useCallback((job) => {
    setActiveJob((prev) => ({ ...(prev || {}), ...job }));
    setStep('result');
  }, []);

  const handleError = useCallback((message) => {
    setError(message);
    setStep('upload');
  }, []);

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
        <span className={styles.eyebrow}>◆ AI Face Swap</span>
        <h1 className={styles.headline}>
          Swap any face <span className={styles.accent}>in seconds</span>
        </h1>
        <p className={styles.subtitle}>
          Drop in a source video and a reference face. Our pipeline handles the rest — detection,
          encoding, rendering and a clean MP4 ready to download.
        </p>
      </div>

      {paidBanner && (
        <div className={styles.banner}>
          ◆ You're subscribed. Upload your files to start swapping.
        </div>
      )}

      <UploadGuide />

      <form className={styles.shell} onSubmit={handleSubmit}>
        <div className={styles.uploads}>
          <UploadZone
            label="Source video"
            sublabel="MP4, MOV, WEBM · Max 100MB"
            icon="🎬"
            accept="video/*"
            file={videoFile}
            onFileSelected={setVideoFile}
            onRemove={() => setVideoFile(null)}
          />
          <UploadZone
            label="Reference face"
            sublabel="JPG, PNG · Clear, front-facing"
            icon="👤"
            accept="image/*"
            file={faceFile}
            onFileSelected={setFaceFile}
            onRemove={() => setFaceFile(null)}
          />
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
          {submitting ? 'Uploading…' : 'Create face swap'}
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
            <span className={styles.diamond}>◆</span> Encrypted upload
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>◆</span> ~30s processing
          </span>
          <span className={styles.footerItem}>
            <span className={styles.diamond}>◆</span> Auto-deleted in 7 days
          </span>
        </div>
      </form>
    </main>
  );
}
