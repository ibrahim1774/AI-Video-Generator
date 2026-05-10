import styles from './PricingBanner.module.css';

/*
 * Always-visible per-feature pricing strip. Lives directly above the
 * form on each feature tab so customers can't miss the credit cost
 * before they hit Generate.
 *
 *   <PricingBanner lines={[
 *     { label: 'Face Swap', cost: '1 credit per video' },
 *   ]} />
 *
 *   <PricingBanner
 *     lines={[
 *       { label: 'UGC video', cost: '1 credit per 3 seconds' },
 *       { label: 'AI character image', cost: '1 credit per generation' },
 *     ]}
 *     note="Pro + audio is billed at 1.5×"
 *   />
 */
export default function PricingBanner({ lines = [], note }) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return (
    <aside className={styles.banner} aria-label="Credit pricing">
      <span className={styles.kicker}>◆ Credit cost</span>
      <ul className={styles.list}>
        {lines.map((line, i) => (
          <li key={`${line.label}-${i}`} className={styles.item}>
            <span className={styles.label}>{line.label}</span>
            <span className={styles.cost}>{line.cost}</span>
          </li>
        ))}
      </ul>
      {note && <span className={styles.note}>{note}</span>}
    </aside>
  );
}
