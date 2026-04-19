/*
 * Tiny in-memory pub/sub log store for the in-app DebugConsole.
 * Mirrors entries to the native console too. No deps.
 *
 * REMOVE this file (and all log() call sites) once we're done
 * diagnosing the 95%-stuck issue.
 */

const entries = [];
const subscribers = new Set();
const MAX = 250;

export function log(level, label, data) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString().slice(11, 23),
    level,
    label,
    data: data === undefined ? null : data,
  };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  subscribers.forEach((fn) => fn(entries));

  if (typeof console !== 'undefined') {
    const c =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    c('[debug]', label, data ?? '');
  }
}

export function subscribe(fn) {
  subscribers.add(fn);
  fn(entries);
  return () => subscribers.delete(fn);
}

export function getAll() {
  return entries.slice();
}

export function clear() {
  entries.length = 0;
  subscribers.forEach((fn) => fn(entries));
}
