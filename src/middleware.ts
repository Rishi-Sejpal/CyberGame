import { NextResponse, type NextRequest } from 'next/server';
import { allowedOrigins, cookiesAreSecure, env, isProduction } from '@/server/config/env';
import { readCookie, serializeCookie, type CookieOptions } from '@/server/security/cookies';
import { timingSafeEqual } from '@/server/security/timing';
import { generateCsrfToken, isWellFormedCsrfToken } from '@/server/security/csrf-token';

/**
 * Edge middleware.
 *
 * Responsibilities, in order of importance:
 *  1. **Give every visitor a CSRF cookie.** A first-time visitor has no session
 *     and no CSRF cookie, so without this the login form could never be
 *     submitted. The cookie is `HttpOnly: false` on purpose — the double-submit
 *     scheme requires the page to read it back into the `x-csrf-token` header.
 *  2. **Reject cross-site mutations before they reach a route handler.** The
 *     Origin allowlist means a hostile page cannot make the request at all.
 *  3. **Redirect unauthenticated visitors** away from protected pages, so a
 *     protected Server Component never has to handle "no user".
 *  4. **Set hardening headers** that Next does not set for us.
 *
 * Runtime: this file runs in the edge runtime, so it may not import
 * `node:crypto`. The CSRF comparison therefore uses the import-free
 * `timingSafeEqual` and the token generator uses Web Crypto.
 *
 * Deliberately NOT done here: session lookup. That needs MongoDB, which does
 * not exist in the edge runtime. The middleware only checks for the *presence*
 * of a session cookie to decide the redirect; real validation always happens in
 * the route handler or Server Component, where a forged cookie has no effect.
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
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const isMutation = !SAFE_METHODS.has(method);

  // Resolved once: a malformed CSRF cookie is replaced rather than trusted.
  const existing = readCookie(request.headers.get('cookie'), env().CSRF_COOKIE_NAME);
  const csrfToken = isWellFormedCsrfToken(existing) ? (existing as string) : generateCsrfToken();
  const shouldSetCsrf = csrfToken !== existing;

  if (isMutation) {
    const rejection = verifyEdgeCsrf(request, csrfToken, existing);
    if (rejection) return finish(rejection, request, csrfToken, shouldSetCsrf);
  }

  const hasSessionCookie = Boolean(
    readCookie(request.headers.get('cookie'), env().SESSION_COOKIE_NAME),
  );

  if (isProtected(pathname) && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return finish(NextResponse.redirect(url), request, csrfToken, shouldSetCsrf);
  }

  if (isAuthPage(pathname) && hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return finish(NextResponse.redirect(url), request, csrfToken, shouldSetCsrf);
  }

  return finish(NextResponse.next(), request, csrfToken, shouldSetCsrf);
}

/**
 * Two independent checks, in cheap-to-expensive order.
 *
 * A request carrying *neither* a cookie nor a header token is refused outright
 * rather than treated as a pass: after this middleware runs, every browser has a
 * CSRF cookie, so its absence means the request did not come from our UI.
 */
function verifyEdgeCsrf(
  request: NextRequest,
  csrfToken: string,
  existingCookie: string | null,
): NextResponse | null {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const allowed = allowedOrigins();

  if (origin) {
    if (!allowed.includes(origin)) return csrfResponse('Request origin is not permitted.');
  } else if (referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (!refererOrigin || !allowed.includes(refererOrigin)) {
      return csrfResponse('Request origin is not permitted.');
    }
  } else {
    return csrfResponse('Missing request origin.');
  }

  const headerToken = request.headers.get('x-csrf-token');
  if (!existingCookie || !isWellFormedCsrfToken(existingCookie) || !headerToken) {
    return csrfResponse('CSRF validation failed.');
  }
  if (!timingSafeEqual(csrfToken, headerToken)) {
    return csrfResponse('CSRF validation failed.');
  }
  return null;
}

function csrfResponse(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'csrf_rejected', message } }, { status: 403 });
}

function csrfCookieOptions(): CookieOptions {
  return {
    // Readable on purpose: the double-submit pattern needs `document.cookie`.
    httpOnly: false,
    secure: cookiesAreSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: env().SESSION_TTL_HOURS * 3_600,
  };
}

/** Applies hardening headers and the CSRF cookie to whichever response is returned. */
function finish(
  response: NextResponse,
  request: NextRequest,
  csrfToken: string,
  shouldSetCsrf: boolean,
): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }

  // CSP for edge runtime - mirrors next.config.ts for defense in depth
  if (isProduction()) {
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
    );
  }

  if (shouldSetCsrf) {
    response.headers.append(
      'Set-Cookie',
      serializeCookie(env().CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions()),
    );
  }

  return response;
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
