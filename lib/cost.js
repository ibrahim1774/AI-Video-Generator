/*
 * Credit cost for a Kling generation. Single source of truth — used
 * by /api/image-to-video, /api/ugc-animate, and the client-side
 * cost preview in DurationSlider / Paywall sub-labels.
 *
 * Rule: 1 credit per 3 seconds (rounded up), with a 1.5× multiplier
 * when the user picks BOTH pro (1080p) AND audio. Every other
 * combination (std silent, std audio, pro silent) stays at the
 * baseline rate because kie.ai's actual cost for those modes is
 * within ~30% of the std-silent base, and we don't want to surprise
 * existing users with a price hike. Pro+audio is the only combo
 * priced ~2× the std-silent base on kie.ai's side, so we mirror it.
 *
 *  Mode        kie.ai $/s   credits per 3s   margin vs $1/cr
 *  -----------------------------------------------------------
 *  std silent  $0.070       1                79%
 *  std audio   $0.100       1                70%
 *  pro silent  $0.090       1                73%
 *  pro audio   $0.135       1.5 (rounded up) 75%
 */

export function costForGeneration({ seconds, mode = 'std', audio = true } = {}) {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  const base = Math.ceil(s / 3);
  const isPremium = mode === 'pro' && audio === true;
  const credits = isPremium ? Math.ceil(base * 1.5) : base;
  return Math.max(1, credits);
}
