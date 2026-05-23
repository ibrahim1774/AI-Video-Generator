# Admin tab-visibility toggle + image-to-video homepage

**Date:** 2026-05-23
**Status:** Approved (design)

## Goal

Two related changes to Ariya Lab:

1. **Admin toggle** — an admin-only switch (on `/admin`) that controls whether
   non-admin users can see and reach the "feature tabs." When OFF, non-admins
   get only the homepage (plus account/utility pages). When ON, everyone sees
   every tab. Admins always see everything regardless of the toggle.

2. **Image-to-video homepage** — the homepage (`/`), currently the Face Swap
   tool, becomes a UGC-3-style image-to-video generator. Face Swap moves to its
   own gated tab.

## Definitions

- **Admin** — a user whose email is in `ADMIN_EMAILS` (default
  `ibrahim3709@gmail.com`). Already implemented via `lib/entitlement.js`
  (`isAdmin`) and the client-side check in `pages/admin/index.js`.
- **Feature tabs (gated)** — Face Swap, UGC Creator, Glow Up, Interior Design,
  Video Editor, History.
- **Always-visible** — Home (`/`), Support, and the account/utility surfaces
  (sign-in, sign-up, dashboard).

## Architecture

### 1. Data: Supabase `app_settings` table

New migration `supabase/migrations/<timestamp>_app_settings.sql`:

```sql
create table if not exists app_settings (
  id text primary key default 'global',
  feature_tabs_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, feature_tabs_enabled)
values ('global', false)
on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Anyone may read the flag (it only reveals whether tabs are shown).
create policy app_settings_public_read on app_settings
  for select using (true);

-- No public writes; writes go through the service-role admin API only.
```

Default `false` → **launch state is locked**: non-admins see only the homepage
until the toggle is flipped on.

### 2. Write path: `/api/admin/feature-tabs` (admin-only)

- `GET` → `{ enabled }` (current value).
- `POST { enabled: boolean }` → updates the row, returns `{ enabled }`.
- Auth: requires a signed-in user whose email passes the admin check; otherwise
  `403`. Uses the Supabase service-role client (`getSupabaseAdmin`) for the
  write. Lives under `/api/admin`, which middleware already gates on auth.

### 3. Read path: `/api/feature-tabs` (public GET)

- Returns `{ enabled }`. Public (no auth) so the Navbar can read it for anon
  visitors. Reads `app_settings.feature_tabs_enabled`.

### 4. Admin UI: `/admin` dashboard

Add a toggle switch labeled "Show all feature tabs to all users" that reads from
and writes to `/api/admin/feature-tabs`, with the current state displayed.

### 5. Navbar visibility (`components/Navbar.js`)

Split `FEATURE_TABS` into always-visible (Home, Support) and gated (Face Swap,
UGC Creator, Glow Up, Interior Design, Video Editor, History). On mount the
Navbar fetches `/api/feature-tabs` and computes `isAdmin` client-side (same
pattern as `pages/admin/index.js`). Gated tabs render only when
`enabled || isAdmin`.

### 6. Route enforcement: `middleware.js` (authoritative gate)

Add the gated page routes to the middleware `matcher`. In middleware (which
already resolves the logged-in `user`):

- Compute `isAdmin` from `user.email` vs `ADMIN_EMAILS`.
- Read `feature_tabs_enabled` from Supabase via the anon client already created
  in middleware, behind a short in-memory TTL cache (~60s) to avoid a DB read on
  every request.
- If the request targets a gated route AND `!enabled` AND `!isAdmin` →
  `NextResponse.redirect('/')`.

This makes the gate real: typing a blocked tab's URL redirects home rather than
merely hiding the nav link.

### 7. Homepage restructure

- Move `pages/index.js` (Face Swap, `FEATURE='face-swap'`) → `pages/face-swap.js`.
  Update its internal `/` redirects/`returnTo`/`redirectTo` to `/face-swap`.
- New `pages/index.js`: a UGC-3-style image-to-video generator — form-first,
  sign-up popup on Generate, credits hidden — but with **upload filtering ON**
  (`uploadTempFile(compressed)` default, not `'skip'`). Isolated `FEATURE='home'`
  local-storage state. `redirectTo`/`returnTo` = `/`.
- Update `Navbar` `FEATURE_TABS`: Home `/` (label e.g. "Image to Video"),
  Face Swap → `/face-swap` (gated).

## Behavior summary

| Scenario | Toggle OFF (default) | Toggle ON |
|---|---|---|
| Non-admin nav | Home + Support only | All tabs |
| Non-admin direct URL to a gated tab | Redirect to `/` | Works |
| Admin | All tabs + access, always | All tabs |

## Out of scope (deliberate)

- `/ugc-2` and `/ugc-3` remain **always reachable** — they are direct ad-funnel
  landing pages; the toggle must not break paid traffic. Only nav *tabs* are
  gated.
- The existing `/image-to-video` page is left unchanged.
- No per-tab granularity — a single global on/off, as requested.

## Risks / notes

- Moving Face Swap off `/` means existing links/ads pointing at `/` for Face Swap
  now land on the image-to-video home. Acceptable per product intent; flagged.
- Turning the homepage into a UGC-3-style page keeps **upload filtering ON**
  (chosen because the homepage is the highest-traffic surface). Generation-time
  moderation is on regardless.
- Middleware flag-cache means a toggle flip can take up to ~60s to propagate to
  all warm instances. Acceptable for an admin visibility switch.

## Testing

- Toggle OFF + anonymous (incognito): nav shows only Home + Support; visiting
  `/glow-up` (or any gated route) redirects to `/`.
- Toggle ON: all tabs appear and are reachable for everyone.
- Admin account: all tabs visible and reachable regardless of toggle.
- Homepage: form-first image-to-video, no credits shown, Generate opens the
  sign-up popup; uploading a disallowed image is still blocked at upload.
- `next build` passes.
