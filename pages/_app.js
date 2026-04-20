import { useState } from 'react';

import '../styles/globals.css';
import AppHead from '../components/AppHead';
import Navbar from '../components/Navbar';
import DebugConsole from '../components/DebugConsole';
import MetaPixel from '../components/MetaPixel';

export default function App({ Component, pageProps }) {
  const [activeTab, setActiveTab] = useState('create');

  return (
    <>
      <AppHead />
      <MetaPixel />
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <Component
        {...pageProps}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DebugConsole />
    </>
  );
}
