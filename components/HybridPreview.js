import styles from './HybridPreview.module.css';

/*
 * Stage-1 preview: shows the hybrid first frame, with side-by-side
 * thumbnails of the source frame + reference image for comparison.
 * User clicks Proceed to commit to the motion-transfer stage.
 */
export default function HybridPreview({
  hybridFrameUrl,
  sourceFrameUrl,
  referenceImageUrl,
  busy,
  onProceed,
  onCancel,
}) {
  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <span className={styles.kicker}>◆ Step 1 of 2 · Preview</span>
        <h2 className={styles.title}>Does this look right?</h2>
        <p className={styles.subtitle}>
          We composed your character into the first frame of your source video. If it looks good, click Proceed and we'll animate the rest. Regenerate if the face isn't quite right.
        </p>
      </header>

      <div className={styles.previewRow}>
        <figure className={styles.bigFrame}>
          {hybridFrameUrl ? (
            <img src={hybridFrameUrl} alt="Generated hybrid frame" />
          ) : (
            <div className={styles.placeholder}>Generating…</div>
          )}
          <figcaption>Hybrid frame</figcaption>
        </figure>

        <div className={styles.sidebar}>
          <figure className={styles.thumb}>
            {sourceFrameUrl ? <img src={sourceFrameUrl} alt="Source video frame" /> : null}
            <figcaption>Source frame</figcaption>
          </figure>
          <figure className={styles.thumb}>
            {referenceImageUrl ? (
              <img src={referenceImageUrl} alt="Reference character" />
            ) : null}
            <figcaption>Reference</figcaption>
          </figure>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onCancel}
          disabled={busy !== null}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onProceed}
          disabled={busy !== null || !hybridFrameUrl}
        >
          {busy === 'proceed' ? 'Starting…' : 'Proceed →'}
        </button>
      </div>

      <p className={styles.note}>
        ◆ One attempt per upload. Proceed to finalize, or cancel and re-upload (counts as a new swap).
      </p>
    </section>
  );
}
