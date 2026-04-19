import styles from './UploadGuide.module.css';

const IMAGE_TIPS = [
  'Front-facing, eyes open, neutral expression',
  'Bright, even lighting \u2014 no harsh side shadows',
  'Crop tight to the face, ideally 1024 px+ on the short edge',
  'JPG or PNG, sharp and high quality',
];

const VIDEO_TIPS = [
  'The clip whose person you want to replace',
  'Frame 1 should clearly show the original person\u2019s face',
  '3 to 30 seconds long, MP4 or MOV, \u2264 100 MB',
  'One dominant face per frame, stable lighting',
];

export default function UploadGuide() {
  return (
    <section className={styles.wrap} aria-label="Best practices">
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>\u25c6 Get the best results</span>
        <p className={styles.lede}>
          Upload your reference face + the source video. We'll generate a preview frame for you to approve, then run the full swap.
        </p>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">\ud83d\udc64</span>
            <h3 className={styles.cardTitle}>Reference face</h3>
          </header>
          <ul className={styles.list}>
            {IMAGE_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </article>

        <article className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.icon} aria-hidden="true">\ud83c\udfac</span>
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
