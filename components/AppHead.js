import Head from 'next/head';

export default function AppHead() {
  return (
    <Head>
      <title>Ariya Lab — AI Video Generator</title>
      <meta
        name="description"
        content="Ariya Lab is a luxury AI video studio. Generate UGC clips, swap faces, restyle portraits, and redesign interiors — all in one place."
      />
      {/* maximum-scale=1, user-scalable=no: disables iOS Safari's
          auto-zoom-on-input-focus (which made the page jump whenever a
          user tapped a text field or file picker) AND blocks pinch zoom.
          Intentional UX trade-off per app-wide design. */}
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
      />
      <meta name="theme-color" content="#060607" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23ffffff'/%3E%3Cstop offset='1' stop-color='%23b9b9c0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='url(%23g)'/%3E%3Ctext x='50%25' y='55%25' dominant-baseline='middle' text-anchor='middle' font-family='Georgia' font-size='20' fill='%230a0a0b'%3EA%3C/text%3E%3C/svg%3E" />
    </Head>
  );
}
