import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import styles from '../../styles/Editor.module.css';
import UploadZone from '../../components/UploadZone';
import AIChatPanel from '../../components/editor/AIChatPanel';
import { uploadTempFile } from '../../lib/uploader';
import { getBrowserSupabase } from '../../lib/supabase';
import { bumpEntitlement } from '../../lib/entitlementBus';
import { saveJob, loadJob, clearJob } from '../../lib/jobPersist';
import { emptyPlan, effectiveDuration } from '../../lib/editPlan';

const FEATURE = 'video-editor';

function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const meta = {
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video metadata.'));
    };
    v.src = url;
  });
}

export default function VideoEditingPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // 'upload' | 'editing' | 'rendering' | 'done'
  const [step, setStep] = useState('upload');

  const [sourceFile, setSourceFile] = useState(null);
  const [sourceUploading, setSourceUploading] = useState(false);
  const [editPlan, setEditPlan] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);

  const [renderId, setRenderId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderResult, setRenderResult] = useState(null);
  const [renderError, setRenderError] = useState('');

  const pollRef = useRef(null);

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

  // Resume in-flight render across page refresh.
  useEffect(() => {
    if (!authLoaded || !authUser) return;
    const saved = loadJob(FEATURE);
    if (saved && saved.predictionId && saved.editPlan) {
      setRenderId(saved.predictionId);
      setEditPlan(saved.editPlan);
      setChatHistory(saved.chatHistory || []);
      setStep('rendering');
    }
  }, [authLoaded, authUser]);

  // Poll render status.
  useEffect(() => {
    if (step !== 'rendering' || !renderId) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/video/render-status?renderId=${encodeURIComponent(renderId)}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(d.error || 'Status check failed.');
        setRenderProgress(d.progress || 0);
        if (d.status === 'completed' && d.outputUrl) {
          setRenderResult({ outputUrl: d.outputUrl });
          setStep('done');
          clearJob(FEATURE);
          bumpEntitlement();
        } else if (d.status === 'failed') {
          setRenderError(d.errorMessage || 'Render failed.');
          setStep('editing');
          clearJob(FEATURE);
          bumpEntitlement(); // refunded server-side
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err.message);
          setStep('editing');
          clearJob(FEATURE);
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, renderId]);

  const handleSourceSelected = async (file) => {
    setSourceFile(file);
    setRenderError('');
    setSourceUploading(true);
    try {
      const meta = await probeVideo(file);
      const url = await uploadTempFile(file);
      const plan = emptyPlan({
        sourceUrl: url,
        duration: meta.duration,
        width: meta.width || 1080,
        height: meta.height || 1920,
      });
      setEditPlan(plan);
      setChatHistory([]);
      setStep('editing');
    } catch (err) {
      setRenderError(err.message || 'Upload failed.');
      setSourceFile(null);
    } finally {
      setSourceUploading(false);
    }
  };

  const handleRender = useCallback(async () => {
    if (!editPlan) return;
    setRenderError('');
    setRenderProgress(0);
    try {
      const r = await fetch('/api/video/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editPlan }),
      });
      const d = await r.json();
      if (r.status === 402) {
        setRenderError(d.code === 'NO_PLAN' ? 'No active plan — visit /dashboard.' : 'Out of credits.');
        return;
      }
      if (!r.ok) throw new Error(d.error || 'Render failed to start.');
      saveJob(FEATURE, {
        predictionId: d.renderId,
        kind: 'video-edit',
        editPlan,
        chatHistory,
      });
      setRenderId(d.renderId);
      setStep('rendering');
      bumpEntitlement(); // credit was just deducted
    } catch (err) {
      setRenderError(err.message);
    }
  }, [editPlan, chatHistory]);

  const handleStartOver = () => {
    clearJob(FEATURE);
    setSourceFile(null);
    setEditPlan(null);
    setChatHistory([]);
    setRenderId(null);
    setRenderResult(null);
    setRenderProgress(0);
    setRenderError('');
    setStep('upload');
  };

  if (!authLoaded || !authUser) {
    return (
      <main className={styles.page}>
        <div className={styles.uploadPrompt}>Loading…</div>
      </main>
    );
  }

  const outDuration = editPlan ? effectiveDuration(editPlan) : 0;

  return (
    <>
      <Head>
        <title>Video Editor — Haelabs</title>
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>◆ Video Editor</div>
            <h1 className={styles.title}>Edit your video with AI</h1>
          </div>
          {step !== 'upload' && (
            <button type="button" onClick={handleStartOver} className={styles.downloadBtn}>
              Start over
            </button>
          )}
        </header>

        {step === 'upload' && (
          <div className={styles.canvas}>
            <UploadZone
              label="Upload a video to edit"
              sublabel="MP4 / MOV · up to 1 GB · max 60s output"
              icon="🎬"
              accept="video/mp4,video/quicktime,video/*"
              file={sourceFile}
              onFileSelected={handleSourceSelected}
              onRemove={() => setSourceFile(null)}
              maxSizeMB={1024}
            />
            {sourceUploading && <div className={styles.canvasMeta}>Uploading…</div>}
            {renderError && <div className={styles.msgError}>{renderError}</div>}
          </div>
        )}

        {(step === 'editing' || step === 'rendering' || step === 'done') && editPlan && (
          <div className={styles.shell}>
            <div className={styles.canvas}>
              {step === 'done' && renderResult ? (
                <>
                  <video src={renderResult.outputUrl} controls className={styles.video} />
                  <div className={styles.canvasFooter}>
                    <span className={styles.canvasMeta}>Render complete</span>
                    <a
                      href={renderResult.outputUrl}
                      download="haelabs-edit.mp4"
                      className={styles.downloadBtn}
                    >
                      ↓ Download
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <video src={editPlan.sourceUrl} controls className={styles.video} />
                  <div className={styles.canvasFooter}>
                    <span className={styles.canvasMeta}>
                      {editPlan.width}×{editPlan.height} · {outDuration.toFixed(1)}s output
                    </span>
                    {step === 'editing' && (
                      <button
                        type="button"
                        className={styles.renderBtn}
                        onClick={handleRender}
                        disabled={editPlan.operations.length === 0}
                      >
                        Render Final Video · 1 credit
                      </button>
                    )}
                  </div>
                  {step === 'rendering' && (
                    <div className={styles.progressWrap}>
                      <div className={styles.progressLabel}>
                        Rendering · {Math.round(renderProgress * 100)}%
                      </div>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${Math.max(4, renderProgress * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {renderError && <div className={styles.msgError}>{renderError}</div>}
                </>
              )}
            </div>

            <AIChatPanel
              editPlan={editPlan}
              setEditPlan={setEditPlan}
              chatHistory={chatHistory}
              setChatHistory={setChatHistory}
            />
          </div>
        )}
      </main>
    </>
  );
}
