import styles from './UploadGuide.module.css';

const IMAGE_TIPS = [
  'Full body and head clearly visible, no obstructions',
  'Front-facing, well-lit, neutral background helps',
  'Aspect ratio between 2:5 and 5:2 — portrait or landscape both fine',
  'JPG or PNG, at least 300px on the short edge, ≤ 10 MB',
];

const VIDEO_TIPS = [
  'A clip showing the motion you want your character to copy',
  'Steady, moderate movement works best — avoid chaotic/very fast action',
  '3 to 30 seconds long, MP4 or MOV, ≤ 100 MB',
  'One clear subject performing the motion',
];

export default function UploadGuide() {
  return (
    <section className={styles.wrap} aria-label="Best practices">
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>◆ Get the best results</span>
        <p className={styles.lede}>
          Upload your character + a motion clip. We'll generate a brand-new video of your character performing that motion.
        </p>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">👤</span>
            <h3 className={styles.cardTitle}>Character image</h3>
          </header>
          <ul className={styles.list}>
            {IMAGE_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">🎬</span>
            <h3 className={styles.cardTitle}>Motion video</h3>
          </header>
          <ul className={styles.list}>
            {VIDEO_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
