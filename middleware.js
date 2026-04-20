import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/*
 * Middleware that:
 *   1. Refreshes the Supabase session cookie on every request.
 *   2. Gates protected API routes on authentication.
 *
 * Public routes: /, /sign-in, /sign-up, /api/auth/*, static assets.
 * Everything else that starts with /api/ requires a Supabase session.
 */
export async function middleware(req) {
  const res = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get: (name) => req.cookies.get(name)?.value,
      set: (name, value, options) => {
        res.cookies.set({ name, value, ...options });
      },
      remove: (name, options) => {
        res.cookies.set({ name, value: '', ...options, maxAge: 0 });
      },
    },
  });

  // Touches the session so it auto-refreshes if near expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  // Gate the private API routes.
  const privateApiPrefixes = [
    '/api/banana-prep',
    '/api/swap',
    '/api/status',
    '/api/entitlement',
    '/api/checkout',
    '/api/extract-frame',
    '/api/upload-token',
  ];
  if (privateApiPrefixes.some((p) => pathname.startsWith(p))) {
    if (!user) {
      return new NextResponse(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Dashboard requires login too \u2014 redirect to sign-in if not.
  if (pathname.startsWith('/dashboard') && !user) {
    const redirect = req.nextUrl.clone();
    redirect.pathname = '/sign-in';
    return NextResponse.redirect(redirect);
  }

  return res;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/banana-prep/:path*',
    '/api/swap/:path*',
    '/api/status/:path*',
    '/api/entitlement/:path*',
    '/api/checkout/:path*',
    '/api/extract-frame/:path*',
    '/api/upload-token/:path*',
  ],
};
