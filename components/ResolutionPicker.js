/*
 * Resolution + audio selector for video generation.
 *
 * - Resolution pills: 480p / 720p / 1080p
 * - Audio toggle: silent / with audio
 *
 * The live credit cost on the Generate CTA reflects whatever the user
 * picks here. See lib/cost.js / RATE_TABLE for the exact rates.
 */

import { ratePerSecond } from '../lib/cost';

const RESOLUTIONS = [
  { key: '480p', label: '480p', sub: 'fastest · cheapest' },
  { key: '720p', label: '720p', sub: 'balanced' },
  { key: '1080p', label: '1080p', sub: 'sharpest · pricier' },
];

export default function ResolutionPicker({
  model = 'standard',
  resolution = '480p',
  audio = false,
  onChange,
  disabled = false,
}) {
  const update = (patch) => {
    if (!onChange) return;
    onChange({ resolution, audio, ...patch });
  };
  const currentRate = ratePerSecond({ model, resolution, audio });
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={labelRowStyle}>
        <span style={labelStyle}>Quality</span>
        <span style={rateStyle}>{currentRate} cr/sec at current selection</span>
      </div>
      <div style={resRowStyle}>
        {RESOLUTIONS.map((r) => {
          const active = resolution === r.key;
          return (
            <button
              key={r.key}
              type="button"
              disabled={disabled}
              onClick={() => update({ resolution: r.key })}
              style={{
                ...pillStyle,
                ...(active ? pillActiveStyle : null),
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
              }}
              aria-pressed={active}
            >
              <span style={pillTitleStyle}>{r.label}</span>
              <span style={pillSubStyle}>{r.sub}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => update({ audio: !audio })}
        disabled={disabled}
        style={{
          ...audioToggleStyle,
          ...(audio ? audioToggleActiveStyle : null),
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        aria-pressed={audio}
      >
        <span style={{ fontWeight: 600 }}>
          {audio ? '🔊 With audio' : '🔇 Silent'}
        </span>
        <span style={{ fontSize: 11, color: '#b8b6b1', marginLeft: 8 }}>
          {audio ? 'tap to disable' : 'tap to enable'}
        </span>
      </button>
    </div>
  );
}

const labelRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 6,
};
const labelStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#b8b6b1',
};
const rateStyle = {
  fontSize: 11,
  color: '#b8b6b1',
};
const resRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  marginBottom: 8,
};
const pillStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '10px 12px',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
  color: '#ededed',
  fontFamily: 'inherit',
  textAlign: 'left',
};
const pillActiveStyle = {
  borderColor: 'rgba(224, 196, 136, 0.6)',
  background: 'rgba(224, 196, 136, 0.12)',
};
const pillTitleStyle = {
  fontFamily: 'var(--font-display, Georgia, serif)',
  fontSize: 15,
  fontWeight: 600,
};
const pillSubStyle = {
  fontSize: 11,
  color: '#b8b6b1',
};
const audioToggleStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.04)',
  color: '#ededed',
  fontFamily: 'inherit',
  textAlign: 'left',
};
const audioToggleActiveStyle = {
  borderColor: 'rgba(224, 196, 136, 0.6)',
  background: 'rgba(224, 196, 136, 0.12)',
};
