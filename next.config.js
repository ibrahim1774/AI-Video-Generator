/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Re-export VITE_* vars (inherited from a sibling project's Vercel
    // config) as NEXT_PUBLIC_* so Next.js inlines them into the
    // client bundle. Saves the user from adding duplicate keys.
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig;
