# Admin Tab-Visibility Toggle + Image-to-Video Homepage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only toggle that gates the "feature tabs" for non-admins (enforced in middleware, hidden in the Navbar), and convert the homepage into a UGC-3-style image-to-video generator with Face Swap demoted to a gated tab.

**Architecture:** A single-row Supabase `app_settings` table holds `feature_tabs_enabled`. A cached server helper reads it; a public endpoint exposes it to the Navbar; an admin endpoint flips it. `middleware.js` redirects non-admins away from gated routes when the flag is off. The homepage (`/`) is replaced by a UGC-3 clone (upload filtering ON); the old Face Swap page moves to `/face-swap`.

**Tech Stack:** Next.js 14 (Pages Router), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Stripe (unaffected). No unit-test runner is configured in this repo, so verification is `next build` + explicit manual smoke tests (the project's existing validation method).

**Branch:** `feat/admin-tab-toggle` (already created).

---

## File Structure

- Create: `supabase/migrations/20260523_app_settings.sql` — the flag table + RLS.
- Create: `lib/featureFlags.js` — cached server-side reader for `feature_tabs_enabled`.
- Create: `pages/api/feature-tabs.js` — public GET `{ enabled }`.
- Create: `pages/api/admin/feature-tabs.js` — admin GET/POST.
- Modify: `middleware.js` — gate the feature routes for non-admins when flag off.
- Modify: `components/Navbar.js` — split tabs into always-visible vs gated; fetch flag; hide gated tabs.
- Modify: `pages/admin/index.js` — add the toggle UI.
- Rename+Modify: `pages/index.js` → `pages/face-swap.js` — Face Swap moves here; internal `/` paths become `/face-swap`.
- Create: `pages/index.js` — new UGC-3-style image-to-video home (upload filtering ON, `FEATURE='home'`).

---

## Task 1: Supabase `app_settings` table

**Files:**
- Create: `supabase/migrations/20260523_app_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Single-row global app settings. Currently holds the feature-tabs
-- visibility flag toggled by admins from /admin.
create table if not exists app_settings (
  id text primary key default 'global',
  feature_tabs_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, feature_tabs_enabled)
values ('global', false)
on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Public read: the flag only reveals whether tabs are shown.
drop policy if exists app_settings_public_read on app_settings;
create policy app_settings_public_read on app_settings
  for select using (true);

-- No public write policy: writes happen via the service-role key only.
```

- [ ] **Step 2: Apply it to Supabase**

Apply via the Supabase SQL editor (Dashboard → SQL) or `supabase db push` if the CLI is linked. This is a manual step — the app cannot create the table at runtime.

Verify in the Supabase Dashboard → Table editor that `app_settings` exists with one row `id='global'`, `feature_tabs_enabled=false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260523_app_settings.sql
git commit -m "Add app_settings table for feature-tabs toggle"
```

---

## Task 2: Cached server-side flag reader

**Files:**
- Create: `lib/featureFlags.js`

- [ ] **Step 1: Write the helper**

```js
import { getSupabaseAdmin } from './supabaseServer';

/*
 * Reads the global feature-tabs flag from app_settings, cached in
 * module memory for a short TTL so we don't hit the DB on every
 * request (middleware calls this often). Fails OPEN-to-false: on any
 * error we treat tabs as disabled, which is the locked-down default.
 */
let cache = { value: false, ts: 0 };
const TTL_MS = 60_000;

export async function getFeatureTabsEnabled() {
  const now = Date.now();
  if (now - cache.ts < TTL_MS) return cache.value;
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('app_settings')
      .select('feature_tabs_enabled')
      .eq('id', 'global')
      .single();
    cache = { value: Boolean(data?.feature_tabs_enabled), ts: now };
  } catch {
    cache = { value: false, ts: now };
  }
  return cache.value;
}

export async function setFeatureTabsEnabled(enabled) {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('app_settings')
    .update({ feature_tabs_enabled: Boolean(enabled), updated_at: new Date().toISOString() })
    .eq('id', 'global');
  if (error) throw new Error(error.message);
  cache = { value: Boolean(enabled), ts: Date.now() };
  return Boolean(enabled);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/featureFlags.js
git commit -m "Add cached feature-tabs flag reader/writer"
```

---

## Task 3: Public read endpoint

**Files:**
- Create: `pages/api/feature-tabs.js`

- [ ] **Step 1: Write the endpoint**

```js
import { getFeatureTabsEnabled } from '../../lib/featureFlags';

// Public: the Navbar reads this for anonymous + signed-in visitors.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const enabled = await getFeatureTabsEnabled();
  res.setHeader('Cache-Control', 'public, max-age=30');
  return res.status(200).json({ enabled });
}
```

- [ ] **Step 2: Verify (dev server)**

Run: `npm run dev`, then in another shell `curl -s localhost:3000/api/feature-tabs`
Expected: `{"enabled":false}`

- [ ] **Step 3: Commit**

```bash
git add pages/api/feature-tabs.js
git commit -m "Add public /api/feature-tabs read endpoint"
```

---

## Task 4: Admin write endpoint

**Files:**
- Create: `pages/api/admin/feature-tabs.js`

- [ ] **Step 1: Write the endpoint**

```js
import { getUserFromRequest } from '../../../lib/supabaseServer';
import { getFeatureTabsEnabled, setFeatureTabsEnabled } from '../../../lib/featureFlags';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'ibrahim3709@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function handler(req, res) {
  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const email = (session.user.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Admin only.' });
  }

  if (req.method === 'GET') {
    const enabled = await getFeatureTabsEnabled();
    return res.status(200).json({ enabled });
  }

  if (req.method === 'POST') {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Body must be { enabled: boolean }.' });
    }
    try {
      const value = await setFeatureTabsEnabled(enabled);
      return res.status(200).json({ enabled: value });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 2: Verify**

Note: `/api/admin/*` is already in middleware's `privateApiPrefixes` (401 if not signed in) and matcher. The endpoint additionally enforces the admin email. Manual verification happens in Task 7 via the dashboard.

- [ ] **Step 3: Commit**

```bash
git add pages/api/admin/feature-tabs.js
git commit -m "Add admin /api/admin/feature-tabs GET/POST endpoint"
```

---

## Task 5: Middleware route enforcement

**Files:**
- Modify: `middleware.js`

- [ ] **Step 1: Add the admin-email constant near the top of `middleware.js` (after the imports)**

```js
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'ibrahim3709@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Gated "feature tab" page routes. Hidden + blocked for non-admins when
// the feature-tabs flag is off. NOTE: /ugc-2 and /ugc-3 are deliberately
// excluded — they are direct ad-funnel landing pages.
const GATED_PAGE_PREFIXES = ['/face-swap', '/ugc', '/glow-up', '/interior-design', '/video/editing', '/history'];
```

Important: list `/face-swap` and `/ugc` such that `/ugc` does not accidentally match `/ugc-2` or `/ugc-3`. Use the exact-or-subpath test in Step 2 (matches `/ugc` and `/ugc/...` but not `/ugc-2`).

- [ ] **Step 2: Add the gating block inside `middleware()`, immediately before the final `return res;`**

```js
  // Feature-tabs gate: when the flag is off, non-admins can't reach the
  // gated tab routes (they get redirected home). Admins always pass.
  const isGated = GATED_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
  if (isGated) {
    const email = (user?.email || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(email);
    if (!isAdmin) {
      let enabled = true;
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('feature_tabs_enabled')
          .eq('id', 'global')
          .single();
        enabled = Boolean(data?.feature_tabs_enabled);
      } catch {
        enabled = false; // fail closed
      }
      if (!enabled) {
        const redirect = req.nextUrl.clone();
        redirect.pathname = '/';
        redirect.search = '';
        return NextResponse.redirect(redirect);
      }
    }
  }
```

Note: middleware uses the anon `supabase` client already created in the function; `app_settings` has a public-read RLS policy so this read succeeds without the service role. (The 60s module cache lives in `lib/featureFlags.js`, used by the API routes; middleware reads directly because it can't share Node module memory with the serverless API functions reliably. The read is a single indexed `select` and acceptable.)

- [ ] **Step 3: Extend the `matcher` config** so middleware runs on the gated page routes. Add these entries to the existing `matcher` array (keep all current entries):

```js
    '/',
    '/face-swap/:path*',
    '/ugc',
    '/ugc/:path*',
    '/glow-up/:path*',
    '/interior-design/:path*',
```

(`/video/editing` and `/history` are already in the matcher.) Do NOT add `/ugc-2` or `/ugc-3`.

- [ ] **Step 4: Build to verify middleware compiles**

Run: `npx next build`
Expected: `✓ Compiled successfully` and no middleware errors.

- [ ] **Step 5: Commit**

```bash
git add middleware.js
git commit -m "Gate feature-tab routes in middleware when flag off (non-admins)"
```

---

## Task 6: Homepage restructure (Face Swap → /face-swap, new image-to-video home)

**Files:**
- Rename: `pages/index.js` → `pages/face-swap.js`
- Modify: `pages/face-swap.js` (internal `/` references)
- Create: `pages/index.js` (UGC-3 clone, upload filtering ON)

- [ ] **Step 1: Move Face Swap to its own route**

```bash
git mv pages/index.js pages/face-swap.js
```

- [ ] **Step 2: Repoint Face Swap's internal redirects from `/` to `/face-swap`**

In `pages/face-swap.js`, change any `redirectTo="/"`, `returnTo="/"`, and `router.push('/')`/`window.location.href = '/'` that send the user back to the face-swap creator so they point to `/face-swap` instead. Leave `Paywall returnTo` as-is only if it already pointed at a non-`/` path. Search:

Run: `grep -n "'/'\|\"/\"\|returnTo\|redirectTo" pages/face-swap.js`
For each hit that means "return to this page," replace `/` with `/face-swap`.

- [ ] **Step 3: Create the new image-to-video homepage as a UGC-3 clone**

```bash
cp pages/ugc-3/index.js pages/index.js
```

- [ ] **Step 4: Adjust the new `pages/index.js`**

```bash
# It now lives at pages/index.js (depth 1), so imports go back to ../ not ../../
perl -0pi -e "s{from '\.\./\.\./}{from '../}g" pages/index.js
# Isolate its persisted state and rename the component + targets.
perl -0pi -e "s/const FEATURE = 'ugc-3';/const FEATURE = 'home';/" pages/index.js
perl -0pi -e "s/export default function Ugc3Page\(\)/export default function HomePage()/" pages/index.js
perl -0pi -e 's{redirectTo="/ugc-3"}{redirectTo="/"}g' pages/index.js
perl -0pi -e 's{returnTo="/ugc-3"}{returnTo="/"}g' pages/index.js
```

- [ ] **Step 5: Turn upload filtering back ON for the homepage**

In `pages/index.js`, find the upload call (copied from ugc-3 with `'skip'`) and restore the default screening:

Replace:
```js
      const url = await uploadTempFile(compressed, 'skip');
```
with:
```js
      const url = await uploadTempFile(compressed);
```
Also delete the UGC-3 "skip the upload-time NSFW/minor pre-screen" comment block directly above it (it no longer applies — the homepage screens uploads).

- [ ] **Step 6: Build to verify both pages compile**

Run: `npx next build`
Expected: `✓ Compiled successfully`; route list shows both `/` and `/face-swap`.

- [ ] **Step 7: Commit**

```bash
git add pages/index.js pages/face-swap.js
git commit -m "Homepage -> image-to-video (UGC-3 style, upload filter ON); Face Swap -> /face-swap"
```

---

## Task 7: Navbar visibility

**Files:**
- Modify: `components/Navbar.js`

- [ ] **Step 1: Replace the `FEATURE_TABS` array** (currently starts with `{ href: '/', label: 'Face Swap' }`) with split arrays + admin-email helper near the top of the file:

```js
const ADMIN_EMAILS_RAW = process.env.NEXT_PUBLIC_ADMIN_EMAILS || '';
const DEFAULT_ADMIN_EMAILS = ['ibrahim3709@gmail.com'];
function isAdminEmail(email) {
  if (!email) return false;
  const list = ADMIN_EMAILS_RAW.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allow = list.length ? list : DEFAULT_ADMIN_EMAILS.map((s) => s.toLowerCase());
  return allow.includes(email.toLowerCase());
}

// Always visible to everyone.
const ALWAYS_TABS = [
  { href: '/', label: 'Image to Video' },
  { href: '/support', label: 'Support' },
];

// Gated: hidden for non-admins unless the feature-tabs flag is on.
const GATED_TABS = [
  { href: '/face-swap', label: 'Face Swap' },
  { href: '/ugc', label: 'UGC Creator' },
  { href: '/glow-up', label: 'Glow Up' },
  { href: '/interior-design', label: 'Interior Design' },
  { href: '/video/editing', label: 'Video Editor' },
  { href: '/history', label: 'History' },
];
```

- [ ] **Step 2: Inside the Navbar component, fetch the flag and the current user, and compute the visible tab list.** Add near the top of the component body (this component already runs client-side; it should already obtain the user via `getBrowserSupabase` — if not, add it):

```js
  const [tabsEnabled, setTabsEnabled] = useState(false);
  const [navEmail, setNavEmail] = useState(null);

  useEffect(() => {
    fetch('/api/feature-tabs')
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setTabsEnabled(Boolean(d?.enabled)))
      .catch(() => {});
    const supabase = getBrowserSupabase();
    if (supabase) {
      supabase.auth.getUser().then(({ data }) => setNavEmail(data?.user?.email || null));
    }
  }, []);

  const showGated = tabsEnabled || isAdminEmail(navEmail);
  const visibleTabs = showGated ? [...ALWAYS_TABS.slice(0, 1), ...GATED_TABS, ...ALWAYS_TABS.slice(1)] : ALWAYS_TABS;
```

(If `getBrowserSupabase` is not already imported in Navbar, add `import { getBrowserSupabase } from '../lib/supabase';` and `useState, useEffect` from React.)

- [ ] **Step 3: Render `visibleTabs`** — replace both `FEATURE_TABS.map(...)` usages (the desktop `.tabs` list and the mobile drawer list) with `visibleTabs.map(...)`. Keep the existing per-tab markup unchanged.

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add components/Navbar.js
git commit -m "Navbar: hide gated tabs for non-admins unless feature-tabs flag is on"
```

---

## Task 8: Admin dashboard toggle UI

**Files:**
- Modify: `pages/admin/index.js`

- [ ] **Step 1: Add toggle state + load/save handlers** inside the `AdminPage` component (it already gates on admin email and has `busy`/`error` state):

```js
  const [tabsEnabled, setTabsEnabled] = useState(null); // null = loading

  useEffect(() => {
    fetch('/api/admin/feature-tabs')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setTabsEnabled(Boolean(d.enabled)))
      .catch(() => setTabsEnabled(false));
  }, []);

  const toggleTabs = async (next) => {
    setTabsEnabled(next); // optimistic
    try {
      const r = await fetch('/api/admin/feature-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed to update.');
      setTabsEnabled(Boolean(d.enabled));
    } catch (e) {
      setTabsEnabled(!next); // revert
      setError(e.message);
    }
  };
```

- [ ] **Step 2: Render a toggle control** in the admin page JSX (place it above or below the existing grant-credits form):

```jsx
        <section style={{ margin: '20px 0', padding: '16px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
          <h3 style={{ margin: '0 0 8px' }}>Feature tabs visibility</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#bbb' }}>
            When ON, all users see every tab. When OFF, non-admins only see the
            homepage + Support.
          </p>
          <button
            type="button"
            disabled={tabsEnabled === null}
            onClick={() => toggleTabs(!tabsEnabled)}
            className={styles.submit}
          >
            {tabsEnabled === null
              ? 'Loading…'
              : tabsEnabled
                ? 'Tabs are ON — click to turn OFF'
                : 'Tabs are OFF — click to turn ON'}
          </button>
        </section>
```

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add pages/admin/index.js
git commit -m "Admin dashboard: feature-tabs visibility toggle"
```

---

## Task 9: Full verification + manual smoke tests

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`; route list includes `/`, `/face-swap`, `/api/feature-tabs`, `/api/admin/feature-tabs`.

- [ ] **Step 2: Manual smoke test (requires the migration applied + dev or preview deploy)**

Run: `npm run dev` (or use a Vercel preview deploy)

Verify each:
- Flag OFF (default), anonymous/incognito: Navbar shows only **Image to Video** + **Support**. Visiting `/glow-up`, `/ugc`, `/face-swap` redirects to `/`. Visiting `/ugc-2` and `/ugc-3` still works.
- Sign in as **admin** (`ibrahim3709@gmail.com`): all tabs visible; all gated routes load even with flag OFF.
- On `/admin`, click the toggle → ON. Within ~60s (middleware cache) a non-admin/incognito session now sees all tabs and can open `/glow-up` etc.
- Toggle back OFF → tabs disappear for non-admins again.
- Homepage `/`: form-first image-to-video, no credit numbers shown, Generate opens the sign-up popup; uploading a disallowed image is blocked at upload (filter ON).

- [ ] **Step 3: Final commit (if any tweaks were needed)** and push the branch

```bash
git push -u origin feat/admin-tab-toggle
```

Then open a PR (or, per the user's workflow, fast-forward `main` after their go-ahead).

---

## Notes for the implementer

- **No test runner exists** in this repo; do not scaffold one. Verify with `next build` + the manual smoke tests above (this matches how the rest of the app is validated).
- **Isolation:** `/ugc`, `/ugc-2`, `/ugc-3`, `/sign-up`, `/api/checkout/*` behavior must remain unchanged. The only edits to shared files are additive (Navbar tab list, middleware gate, admin page).
- **Fail-closed:** both the flag reader and the middleware read default to `false` (tabs hidden) on error — the safe direction.
- **Migration is manual:** the table must be created in Supabase before deploying, or every gated route stays redirected for non-admins (flag read fails → false), which is the safe default but will look like "tabs never show even when toggled on" until the table exists.
