/*
 * Global page footer with a support-contact link.
 * Rendered by pages/_app.js after every <Component />.
 */

export default function Footer() {
  return (
    <footer
      style={{
        position: 'relative',
        zIndex: 3,
        marginTop: 'auto',
        padding: '34px 16px 38px',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.35))',
      }}
    >
      {/* Hairline platinum glow on the top edge */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -1,
          left: 0,
          right: 0,
          height: 1,
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.16) 50%, transparent)',
        }}
      />
      <div
        style={{
          fontFamily: 'var(--font-display, Georgia, serif)',
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: '#f6f6f7',
          marginBottom: 12,
        }}
      >
        Ariya&nbsp;Lab
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.42)',
          marginBottom: 6,
        }}
      >
        Need help?
      </div>
      <a
        href="mailto:support@davoxa.com"
        style={{
          color: '#ededed',
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.28)',
          paddingBottom: 1,
        }}
      >
        support@davoxa.com
      </a>
    </footer>
  );
}
