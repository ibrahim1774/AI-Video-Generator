/*
 * Credit cost for a Kling generation. Single source of truth — used
 * by /api/image-to-video, /api/ugc-animate, and the client-side
 * cost preview in DurationSlider / Paywall sub-labels.
 *
 * Rule: 1 credit per 1 second of generated video. Pro (1080p) + audio
 * picks up a 1.5× multiplier on top because that's the only kie.ai
 * mode that costs ~2× the std-silent base on their side, so we have
 * to price it accordingly to keep margins positive.
 *
 *  Mode        kie.ai $/s   credits per second
 *  -------------------------------------------
 *  std silent  $0.070       1
 *  std audio   $0.100       1
 *  pro silent  $0.090       1
 *  pro audio   $0.135       1.5 (rounded up)
 */

export function costForGeneration({ seconds, mode = 'std', audio = true } = {}) {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  const isPremium = mode === 'pro' && audio === true;
  const credits = isPremium ? Math.ceil(s * 1.5) : s;
  return Math.max(1, credits);
}
