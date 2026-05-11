/*
 * Ariya Lab namespace for Stripe customer metadata.
 *
 * Both ariyalab.online and haelabs.live share the same Supabase + Stripe
 * accounts. To keep their credit ledgers independent, ariyalab writes its
 * per-customer state to namespaced metadata fields. Haelabs continues to
 * use the legacy field names ('creditsRemaining', etc.) untouched.
 *
 * A customer who subscribes to both sites has two parallel balances on
 * the same Stripe customer record, billed separately. Neither site can
 * read or overwrite the other's credit pool.
 *
 * Fields under `shared` are intentionally NOT namespaced — both sites
 * write the same value (e.g. supabase_user_id) or the field is used for
 * idempotency where last-write-wins with the same value is correct.
 */
export const META_NS = 'ariyalab';

export const KEY = {
  credits:           `${META_NS}_credits`,
  imageCredits:      `${META_NS}_image_credits`,
  imagePeriodStart:  `${META_NS}_image_period_start`,
  lastSeededCap:     `${META_NS}_last_seeded_cap`,
  pendingJobs:       `${META_NS}_pending_jobs`,
  periodStart:       `${META_NS}_period_start`,
  videosUsedThisPeriod: `${META_NS}_videos_used_this_period`,
  plan:              `${META_NS}_plan`,
  trialCreditsUsed:  `${META_NS}_trial_credits_used`,
  trialUsed:         `${META_NS}_trial_used`,
  lastReportedPeriodStart: `${META_NS}_last_reported_period_start`,
  processedSessions: `${META_NS}_processed_sessions`,

  // Fields below stay shared across deployments — string values are NOT
  // namespaced. Both sites write the same value (idempotent).
  shared: {
    supabaseUserId:      'supabase_user_id',
    pendingSupabaseLink: 'pending_supabase_link',
  },
};

export function nsEventId(rawId) {
  return `${META_NS}-${rawId}`;
}
