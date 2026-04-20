import { useState } from 'react';
import Script from 'next/script';

import '../styles/globals.css';
import AppHead from '../components/AppHead';
import Navbar from '../components/Navbar';
import MetaPixel from '../components/MetaPixel';
import ClarityTracker from '../components/ClarityTracker';

export default function App({ Component, pageProps }) {
  const [activeTab, setActiveTab] = useState('create');

  return (
    <>
      <AppHead />
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <MetaPixel />
      <ClarityTracker />
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <Component
        {...pageProps}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}
