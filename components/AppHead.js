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
      <meta name="theme-color" content="#060608" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23C9A96E'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='Georgia' font-size='20' fill='%23060608'%3EA%3C/text%3E%3C/svg%3E" />
    </Head>
  );
}
