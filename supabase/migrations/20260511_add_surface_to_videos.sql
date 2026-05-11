-- Add a deployment tag to the videos table so Haelabs and Ariya Lab
-- can filter /history + cleanup-history independently.
--
-- Backward-compatible: existing rows backfill to 'haelabs'; new rows
-- from either deployment pick their own value. Haelabs's queries don't
-- reference `surface`, so they continue to read all rows.
--
-- Run this migration BEFORE deploying the ariyalab code that writes
-- `surface: 'ariyalab'` on new inserts.

alter table public.videos
  add column if not exists surface text not null default 'haelabs';

-- Backfill any rows that might predate the default (defensive — the
-- `default 'haelabs'` clause above handles new rows; this catches any
-- pre-existing NULLs from migrations that ran without a default).
update public.videos set surface = 'haelabs' where surface is null;

-- Optional index to speed up the per-surface filter on /history.
create index if not exists videos_user_surface_idx
  on public.videos(user_id, surface, expires_at desc);
