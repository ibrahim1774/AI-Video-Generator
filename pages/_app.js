import { useState } from 'react';

import '../styles/globals.css';
import AppHead from '../components/AppHead';
import Navbar from '../components/Navbar';

export default function App({ Component, pageProps }) {
  const [activeTab, setActiveTab] = useState('create');

  return (
    <>
      <AppHead />
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <Component
        {...pageProps}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}
