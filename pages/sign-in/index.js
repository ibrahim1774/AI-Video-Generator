import Head from 'next/head';
import { useState } from 'react';

import AuthModal from '../../components/AuthModal';

export default function SignInPage() {
  const [open] = useState(true);
  return (
    <>
      <Head>
        <title>Sign in — Ariya Lab</title>
      </Head>
      <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AuthModal open={open} onClose={() => (window.location.href = '/')} initialMode="signin" />
      </main>
    </>
  );
}
