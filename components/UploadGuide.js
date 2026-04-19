import styles from './UploadGuide.module.css';

const FACE_TIPS = [
  'Front-facing, eyes open, neutral expression',
  'Bright, even lighting — no harsh side shadows',
  'No sunglasses, hats, hands or hair covering the face',
  'Crop tight to the face, ideally 1024 px+ on the short edge',
];

const VIDEO_TIPS = [
  'Keep the clip under 30 seconds for best speed and quality',
  '720p–1080p resolution (4K wastes credits without improving the swap)',
  'One dominant face per frame, stable lighting, minimal occlusion',
  'MP4, MOV or WEBM — up to 100 MB',
];

export default function UploadGuide() {
  return (
    <section className={styles.wrap} aria-label="Best practices for face swap">
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>◆ Get the best results</span>
        <p className={styles.lede}>
          Two minutes of prep saves a re-run. Here's what works.
        </p>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">👤</span>
            <h3 className={styles.cardTitle}>Reference face</h3>
          </header>
          <ul className={styles.list}>
            {FACE_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">🎬</span>
            <h3 className={styles.cardTitle}>Source video</h3>
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
