/*
 * Reusable duration slider for Kling v3 video generation.
 * Range 3–15s, 1s steps. Shows live cost — defers to costForGeneration
 * which factors in mode (std/pro) + audio (because pro+audio costs
 * more on kie.ai's side and we mirror that).
 *
 * The slider uses a real range input so it works on touch and
 * keyboard, plus a small number of stop ticks below for orientation.
 */

import { costForGeneration } from '../lib/cost';

// Backwards-compat shim — older callers that didn't have mode/audio
// context. Treats them as the std-silent baseline (= 1cr per 3s).
export function costForDuration(seconds, mode = 'std', audio = false) {
  return costForGeneration({ seconds, mode, audio });
}

export default function DurationSlider({
  value,
  onChange,
  label = 'Length',
  min = 3,
  max = 15,
  showCost = true,
  ariaLabel = 'Duration',
  mode = 'std',
  audio = false,
}) {
  const cost = costForGeneration({ seconds: value, mode, audio });
  return (
    <div>
      <div
        style={{
          fontFamily: 'inherit',
          fontSize: 13,
          color: '#bbb',
          margin: '12px 0 6px',
          letterSpacing: '0.02em',
        }}
      >
        {label}:{' '}
        <span style={{ color: '#ededed' }}>{value} seconds</span>
        {showCost && (
          <>
            {' · '}
            <span style={{ color: '#ededed' }}>
              {cost} credit{cost === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#ededed' }}
        aria-label={ariaLabel}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: '#888',
          marginTop: 4,
          fontFamily: 'inherit',
        }}
      >
        <span>{min}s</span>
        <span>{max}s</span>
      </div>
    </div>
  );
}
