import { getSupabaseAdmin } from './supabaseServer';

/*
 * Reads the global feature-tabs flag from app_settings, cached in
 * module memory for a short TTL so we don't hit the DB on every
 * request (the API routes call this often). Fails to `false` on any
 * error — the locked-down, safe default.
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
    .update({
      feature_tabs_enabled: Boolean(enabled),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'global');
  if (error) throw new Error(error.message);
  cache = { value: Boolean(enabled), ts: Date.now() };
  return Boolean(enabled);
}
