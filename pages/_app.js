import { useEffect } from 'react';
import Script from 'next/script';

import '../styles/globals.css';
import AppHead from '../components/AppHead';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import MetaPixel from '../components/MetaPixel';
import TikTokPixel from '../components/TikTokPixel';
import TikTokRouteEvents from '../components/TikTokRouteEvents';
import ClarityTracker from '../components/ClarityTracker';

export default function App({ Component, pageProps }) {
  // Capture ad-click params (utm_* / fbclid / …) from the landing URL so
  // checkout can stamp them into Stripe metadata for /tracking.
  useEffect(() => {
    import('../lib/adAttribution')
      .then((m) => m.captureAdParamsOnLoad())
      .catch(() => {});
  }, []);

  return (
    <>
      <AppHead />
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <MetaPixel />
      <TikTokPixel />
      <TikTokRouteEvents />
      <ClarityTracker />
      <Navbar />
      <Component {...pageProps} />
      <Footer />
    </>
  );
}
