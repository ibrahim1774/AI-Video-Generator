import { useCallback, useState } from 'react';

import styles from '../styles/Home.module.css';
import UploadZone from '../components/UploadZone';
import Processing from '../components/Processing';
import Result from '../components/Result';
import JobHistory from '../components/JobHistory';
import { uploadTempFile } from '../lib/uploader';

export default function Home({ activeTab, onTabChange }) {
  const [step, setStep] = useState('upload');
  const [videoFile, setVideoFile] = useState(null);
  const [faceFile, setFaceFile] = useState(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  const canSubmit = Boolean(videoFile && faceFile && consent && !submitting);

  const reset = useCallback(() => {
    setStep('upload');
    setVideoFile(null);
    setFaceFile(null);
    setConsent(false);
    setError('');
    setSubmitting(false);
    setActiveJob(null);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError('');
    setSubmitting(true);

    try {
      const [videoUrl, faceUrl] = await Promise.all([
        uploadTempFile(videoFile),
        uploadTempFile(faceFile),
      ]);

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
      const data = await res.json();
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
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

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

  if (step === 'processing' && activeJob) {
    return (
      <main className={styles.page}>
        <Processing
          jobId={activeJob.jobId}
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
