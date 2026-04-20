import { useState } from 'react';

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
