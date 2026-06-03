import Head from 'next/head';

import styles from '../styles/Home.module.css';

const SUPPORT_EMAIL = 'support@davoxa.com';

export default function SupportPage() {
  return (
    <>
      <Head>
        <title>Support — Contact us</title>
      </Head>
      <main className={styles.page} style={{ paddingTop: 40, paddingBottom: 60 }}>
        <div className={styles.hero} style={{ marginBottom: 18 }}>
          <span className={styles.eyebrow}>◆ Support</span>
          <h1
            className={styles.headline}
            style={{ fontSize: 'clamp(28px, 4.4vw, 44px)', margin: '14px 0 10px', lineHeight: 1.15 }}
          >
            Contact us — membership questions, concerns, or anything else
          </h1>
          <p className={styles.subtitle} style={{ fontSize: 15, lineHeight: 1.55 }}>
            Email us anytime. We usually reply within one business day.
          </p>
        </div>

        <section
          aria-label="Support contact"
          style={{
            position: 'relative',
            maxWidth: 520,
            width: '100%',
            margin: '0 auto',
            padding: '28px 28px 24px',
            borderRadius: 'var(--radius-2xl, 32px)',
            border: '1px solid rgba(255,255,255,0.1)',
            background:
              'radial-gradient(130% 70% at 50% -10%, rgba(255,255,255,0.06), transparent 56%), ' +
              'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)), ' +
              'rgba(10,10,12,0.5)',
            backdropFilter: 'blur(16px) saturate(130%)',
            WebkitBackdropFilter: 'blur(16px) saturate(130%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), var(--shadow-xl)',
            textAlign: 'center',
          }}
        >
          {/* Specular sheen */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: '0 0 auto 0',
              height: '44%',
              borderRadius: 'var(--radius-2xl, 32px) var(--radius-2xl, 32px) 0 0',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 11,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--text-dim, #a6a6ad)',
              marginBottom: 14,
            }}
          >
            Reach the team
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-display, Georgia, serif)',
              color: 'var(--text, #f6f6f7)',
              fontSize: 20,
              fontWeight: 500,
              textDecoration: 'none',
              letterSpacing: '-0.01em',
              borderBottom: '1px solid rgba(255,255,255,0.25)',
              padding: '2px 6px',
              transition: 'color 0.2s ease, border-color 0.2s ease',
            }}
          >
            {SUPPORT_EMAIL}
          </a>
          <div
            style={{
              marginTop: 18,
              fontSize: 13,
              color: 'var(--text-dim, #a6a6ad)',
              lineHeight: 1.6,
            }}
          >
            Billing, refund requests, plan changes, technical issues — all go to
            the same inbox. Include your account email so we can find you fast.
          </div>
        </section>
      </main>
    </>
  );
}
