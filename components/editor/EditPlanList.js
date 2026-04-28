import styles from '../../styles/Editor.module.css';

function describe(op) {
  switch (op.type) {
    case 'trim': return `Trim ${op.start}s → ${op.end}s`;
    case 'speed': return `Speed × ${op.factor}`;
    case 'textOverlay': return `Text "${op.text}" (${op.start}s–${op.end}s)`;
    case 'captions': return `Captions (${op.segments.length} lines)`;
    case 'audioTrack': return `Audio track${op.volume !== undefined ? ` @ ${op.volume}` : ''}`;
    case 'fade': return `Fade ${op.direction} ${op.duration}s`;
    case 'crop': return `Crop to ${op.aspectRatio}`;
    case 'filter': {
      const parts = [];
      if (op.brightness !== undefined) parts.push(`brightness ${op.brightness}`);
      if (op.contrast !== undefined) parts.push(`contrast ${op.contrast}`);
      if (op.saturation !== undefined) parts.push(`saturation ${op.saturation}`);
      return `Filter (${parts.join(', ') || 'none'})`;
    }
    case 'reverse': return 'Reverse';
    default: return op.type;
  }
}

export default function EditPlanList({ operations, onRemove }) {
  return (
    <div className={styles.planList}>
      <div className={styles.planTitle}>
        ◆ Edit plan{operations.length ? ` (${operations.length})` : ''}
      </div>
      {operations.length === 0 ? (
        <div className={styles.planRowEmpty}>No edits yet — describe one in the chat above.</div>
      ) : (
        operations.map((op) => (
          <div key={op.id} className={styles.planRow}>
            <span className={styles.planLabel}>{describe(op)}</span>
            <button
              type="button"
              className={styles.planRemove}
              onClick={() => onRemove(op.id)}
              aria-label="Remove operation"
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
