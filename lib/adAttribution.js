// Ad-click attribution capture (port of the aibarber.org / primehub.dev
// module — same cookie contract, ariyalab names).
//
// Ads land with tracking params appended (utm_* / fbclid / ttclid / gclid,
// plus any tw_*). We capture whatever is present on the landing URL and
// persist it so the Purchase (pages/api/checkout → Stripe metadata) carries
// which campaign/ad drove it — read server-side from the `al_attr` cookie.
//
// Two touch sets:
//   • LAST touch (al_attr) — refreshed on every ad click.
//   • FIRST touch (al_attr_f) — written once, never overwritten; checkout
//     stamps it with an fc_ prefix so /tracking can offer both models.

const STORAGE_KEY = 'ariyalab_ad_attribution';
const COOKIE_NAME = 'al_attr';
const FIRST_STORAGE_KEY = STORAGE_KEY + '_first';
const FIRST_COOKIE_NAME = 'al_attr_f';
const COOKIE_MAX_AGE_DAYS = 30;

// Param keys we forward (anything else on the URL is ignored).
function isTrackingParam(key) {
  const k = key.toLowerCase();
  return (
    k.startsWith('tw_') ||
    k.startsWith('utm_') ||
    k === 'fbclid' ||
    k === 'ttclid' ||
    k === 'gclid'
  );
}

function collectFromUrl() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const out = {};
  params.forEach((value, key) => {
    if (value && isTrackingParam(key)) {
      out[key.toLowerCase()] = value.slice(0, 500); // Stripe metadata value cap
    }
  });
  return out;
}

// Call once per app load (covers every page — _app renders for all routes).
export function captureAdParamsOnLoad() {
  if (typeof window === 'undefined') return;
  try {
    const fresh = collectFromUrl();
    if (Object.keys(fresh).length === 0) return;
    const record = {
      ...fresh,
      landing_path: window.location.pathname,
      captured_at: new Date().toISOString(),
    };
    const json = JSON.stringify(record);
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* ignore */ }
    // Cookie so same-origin API routes (checkout) can read it server-side.
    document.cookie =
      `${COOKIE_NAME}=${encodeURIComponent(json)}; path=/; max-age=${COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}; SameSite=Lax`;
    try {
      if (!localStorage.getItem(FIRST_STORAGE_KEY)) {
        localStorage.setItem(FIRST_STORAGE_KEY, json);
        document.cookie =
          `${FIRST_COOKIE_NAME}=${encodeURIComponent(json)}; path=/; max-age=${COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}; SameSite=Lax`;
      }
    } catch { /* first-touch is best-effort too */ }
  } catch {
    /* storage/cookies unavailable — attribution is best-effort */
  }
}

// Client-side read (available for lead/pixel payloads).
export function getAdAttribution() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
