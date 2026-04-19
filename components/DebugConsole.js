import { useEffect, useState } from 'react';

import styles from './DebugConsole.module.css';
import { subscribe, clear } from '../lib/debugLog';

/*
 * Always-visible floating panel showing every step of the upload →
 * predict → poll lifecycle. Diagnostic only — remove with the rest
 * of the debug scaffolding once the bug is found.
 */

function safeJson(value) {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function DebugConsole() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribe(setItems), []);

  const copy = async () => {
    const text = items
      .map((e) => `${e.ts} [${e.level}] ${e.label}\n${safeJson(e.data)}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy logs:', text);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={`${styles.toggle} ${styles.collapsed}`}
        onClick={() => setOpen(true)}
        aria-label="Open debug console"
      >
        ⌃ Debug ({items.length})
      </button>
    );
  }

  const reversed = items.slice().reverse();

  return (
    <div className={styles.panel} role="log" aria-live="polite">
      <header className={styles.header}>
        <span className={styles.title}>Debug ({items.length})</span>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={copy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" className={styles.btn} onClick={clear}>
            Clear
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setOpen(false)}
            aria-label="Minimize"
          >
            –
          </button>
        </div>
      </header>
      <div className={styles.list}>
        {reversed.length === 0 ? (
          <div className={styles.empty}>No events yet — try a swap.</div>
        ) : (
          reversed.map((e) => (
            <div key={e.id} className={`${styles.entry} ${styles[e.level] || ''}`}>
              <div className={styles.meta}>
                <span className={styles.ts}>{e.ts}</span>
                <span className={styles.level}>{e.level}</span>
                <span className={styles.label}>{e.label}</span>
              </div>
              {e.data !== null && e.data !== undefined && (
                <pre className={styles.data}>{safeJson(e.data)}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
