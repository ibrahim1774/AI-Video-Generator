/*
 * Reusable duration slider for Kling v3 video generation.
 * Range 3–15s, 1s steps. Shows live cost (1 credit per 3s, rounded up).
 *
 * The slider uses a real range input so it works on touch and
 * keyboard, plus a small number of stop ticks below for orientation.
 */

export function costForDuration(seconds) {
  return Math.max(1, Math.ceil(Number(seconds) / 3));
}

export default function DurationSlider({
  value,
  onChange,
  label = 'Length',
  min = 3,
  max = 15,
  showCost = true,
  ariaLabel = 'Duration',
}) {
  const cost = costForDuration(value);
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
