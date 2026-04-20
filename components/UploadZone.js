import { useRef, useState } from 'react';

import styles from './UploadZone.module.css';

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UploadZone({
  label,
  sublabel,
  icon,
  accept,
  file,
  onFileSelected,
  onRemove,
  maxSizeMB,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [sizeError, setSizeError] = useState('');

  const openPicker = () => inputRef.current && inputRef.current.click();

  const tryAccept = (selected) => {
    if (!selected) return;
    if (maxSizeMB && selected.size > maxSizeMB * 1024 * 1024) {
      setSizeError(
        `File too large (${formatSize(selected.size)}) — max ${maxSizeMB} MB.`
      );
      return;
    }
    setSizeError('');
    onFileSelected(selected);
  };

  const handleInputChange = (e) => {
    const selected = e.target.files && e.target.files[0];
    tryAccept(selected);
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = e.dataTransfer.files && e.dataTransfer.files[0];
    tryAccept(dropped);
  };

  const hasFile = Boolean(file);
  const zoneClass = [
    styles.zone,
    hasFile ? styles.zoneFilled : '',
    dragOver ? styles.zoneDragOver : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={zoneClass}
      onClick={hasFile ? undefined : openPicker}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !hasFile) {
          e.preventDefault();
          openPicker();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={styles.input}
        onChange={handleInputChange}
      />

      {hasFile && (
        <button
          type="button"
          className={styles.remove}
          aria-label="Remove file"
          onClick={(e) => {
            e.stopPropagation();
            setSizeError('');
            onRemove();
          }}
        >
          ×
        </button>
      )}

      <div className={styles.icon} aria-hidden="true">
        {hasFile ? '✓' : icon}
      </div>
      <div className={styles.label}>{label}</div>
      {hasFile ? (
        <div className={styles.fileMeta}>
          <span className={styles.fileName}>{file.name}</span>
          <span className={styles.fileSize}>{formatSize(file.size)}</span>
        </div>
      ) : (
        <div className={styles.sublabel}>{sublabel}</div>
      )}
      {sizeError && (
        <div
          style={{
            marginTop: 8,
            color: '#ff8a8a',
            fontSize: 12,
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          {sizeError}
        </div>
      )}
    </div>
  );
}
