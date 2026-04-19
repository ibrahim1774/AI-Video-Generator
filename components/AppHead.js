import Head from 'next/head';

export default function AppHead() {
  return (
    <Head>
      <title>FaceForge — AI Face Swap</title>
      <meta
        name="description"
        content="FaceForge is a luxury face-swap studio. Upload a video and a reference photo, and get a finished swap in seconds."
      />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="theme-color" content="#060608" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23C9A96E'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='Georgia' font-size='20' fill='%23060608'%3EF%3C/text%3E%3C/svg%3E" />
    </Head>
  );
}
