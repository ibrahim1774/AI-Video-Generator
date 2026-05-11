/*
 * Reusable duration slider for Ariya Lab video generation.
 * Range 3–15s, 1s steps. Live cost reflects the chosen model
 * (standard | studio-pro) × resolution (480p|720p|1080p) × audio.
 */

import { costForGeneration } from '../lib/cost';

// Convenience helper for callers that compute cost outside the slider.
export function costForDuration(seconds, model = 'standard', resolution = '480p', audio = false) {
  return costForGeneration({ seconds, model, resolution, audio });
}

export default function DurationSlider({
  value,
  onChange,
  label = 'Length',
  min = 3,
  max = 15,
  showCost = true,
  ariaLabel = 'Duration',
  model = 'standard',
  resolution = '480p',
  audio = false,
}) {
  const cost = costForGeneration({ seconds: value, model, resolution, audio });
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
