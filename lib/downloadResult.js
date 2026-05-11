/*
 * Trigger an automatic browser download for a remote video URL. Falls
 * back to opening the URL in a new tab if the cross-origin fetch is
 * blocked (Replicate's signed URLs allow it today, but we don't want
 * to silently break if that changes).
 */
export async function downloadVideo(url, filename = 'ariyalab.mp4') {
  if (!url || typeof window === 'undefined') return;

  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  } catch (err) {
    // Last-resort fallback: open the URL — the browser will show the
    // file with its native player, where the user can save manually.
    console.warn('[downloadVideo] direct fetch failed; opening URL', err?.message);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
