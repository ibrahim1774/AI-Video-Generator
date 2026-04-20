import Head from 'next/head';
import { useState } from 'react';

import AuthModal from '../../components/AuthModal';

export default function SignUpPage() {
  const [open] = useState(true);
  return (
    <>
      <Head>
        <title>Sign up — FaceForge</title>
      </Head>
      <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AuthModal open={open} onClose={() => (window.location.href = '/')} initialMode="signup" />
      </main>
    </>
  );
}
