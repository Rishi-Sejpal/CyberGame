import { NextResponse, type NextRequest } from 'next/server';
import { allowedOrigins, env } from '@/server/config/env';
import { readCookie } from '@/server/security/cookies';
import { timingSafeEqual } from '@/server/security/timing';

/**
 * Edge middleware.
 *
 * Responsibilities, in order of importance:
 *  1. **Reject cross-site mutations before they reach a route handler.** The
 *     Origin allowlist check here means a hostile page cannot even make the
 *     request; the per-handler `verifyCsrf` is the second layer.
 *  2. **Redirect unauthenticated visitors** away from protected pages, so a
 *     protected Server Component never has to handle "no user".
 *  3. **Set hardening headers** that Next does not set for us.
 *
 * Runtime: this file runs in the edge runtime, so it may not import `node:crypto`.
 * The CSRF comparison therefore uses the import-free `timingSafeEqual` rather
 * than the Node-only `crypto.constantTimeEqual`.
 *
 * Deliberately NOT done here: session lookup. That needs MongoDB, which does
 * not exist in the edge runtime. Instead the middleware only checks for the
 * *presence* of a well-formed session cookie to decide the redirect; the real
 * validation always happens in the route handler / Server Component, where a
 * forged cookie has no effect.
 */

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/game',
  '/missions',
  '/progress',
  '/achievements',
  '/inventory',
  '/modules',
  '/settings',
  '/profile',
];

const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  const response = applyHeaders(request);

  // --- CSRF / origin gate ---------------------------------------------------
  if (!SAFE_METHODS.has(method)) {
    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');
    const allowed = allowedOrigins();

    let originOk = false;
    if (origin) originOk = allowed.includes(origin);
    else if (referer) {
      try {
        originOk = allowed.includes(new URL(referer).origin);
      } catch {
        originOk = false;
      }
    }

    if (!originOk) {
      return NextResponse.json(
        { error: { code: 'csrf_rejected', message: 'Request origin is not permitted.' } },
        { status: 403, headers: response.headers },
      );
    }

    // Double-submit check at the edge: cheap, and blocks a same-site subdomain
    // that somehow passes the origin test.
    const cookieToken = readCookie(request.headers.get('cookie'), env().CSRF_COOKIE_NAME);
    const headerToken = request.headers.get('x-csrf-token');
    if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
      return NextResponse.json(
        { error: { code: 'csrf_rejected', message: 'CSRF validation failed.' } },
        { status: 403, headers: response.headers },
      );
    }
  }

  // --- Session presence gate for page routes --------------------------------
  const hasSessionCookie = Boolean(readCookie(request.headers.get('cookie'), env().SESSION_COOKIE_NAME));

  if (isProtected(pathname) && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    const redirect = NextResponse.redirect(url);
    copyHeaders(response, redirect);
    return redirect;
  }

  if (isAuthPage(pathname) && hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    const redirect = NextResponse.redirect(url);
    copyHeaders(response, redirect);
    return redirect;
  }

  return response;
}

function applyHeaders(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }
  return response;
}

function copyHeaders(from: NextResponse, to: NextResponse): void {
  from.headers.forEach((value, key) => {
    to.headers.set(key, value);
  });
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. `/api` is included:
     * the origin gate must run before the route handler.
     */
    '/((?!_next/static|_next/image|favicon.ico|favicon.svg|assets/|fonts/|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|css|js|map)$).*)',
  ],
};
