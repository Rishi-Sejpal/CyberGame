import 'server-only';

import type { NextRequest } from 'next/server';
import { env, cookiesAreSecure, isOriginAllowed } from '@/server/config/env';
import { constantTimeEqual, generateSecret, hashToken } from './crypto';
import { auditDetached } from './audit';
import { readCookie, type CookieJar } from './cookies';

/**
 * CSRF protection — three independent layers.
 *
 * 1. **SameSite=Lax session cookie.** A cross-site `POST` does not carry it, so
 *    the request is already unauthenticated. This alone blocks classic CSRF.
 * 2. **Origin / Referer allowlist.** Every mutating request must present an
 *    `Origin` (or, as a fallback, a `Referer`) inside the configured set. A
 *    mutation with *neither* is refused outright.
 * 3. **Double-submit token.** A readable, non-`HttpOnly` cookie is paired with
 *    an `x-csrf-token` header that must match. Layer 1 already blocks
 *    cross-site delivery; this layer exists for same-site subdomain takeover
 *    and for any future same-origin injection.
 *
 * Why not tokens alone? A custom-header scheme breaks plain `<form>` posts and
 * requires JS on every write. Why not SameSite alone? Because its semantics
 * have historically differed across browsers and for `null` origins. Belt,
 * braces, and a lock.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER = 'x-csrf-token';

export function csrfCookieName(): string {
  return env().CSRF_COOKIE_NAME;
}

function csrfCookieOptions() {
  return {
    httpOnly: false, // deliberate: a double-submit cookie must be readable by the client
    secure: cookiesAreSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env().SESSION_TTL_HOURS * 3_600,
  };
}

/** Issues (or re-arms) the double-submit token. Idempotent per browser session. */
export function ensureCsrfToken(jar: CookieJar): string {
  const existing = jar.get(csrfCookieName());
  if (existing && existing.length >= 32) return existing;
  const token = generateSecret(32);
  jar.set(csrfCookieName(), token, csrfCookieOptions());
  return token;
}

/** Read-only variant removed: the edge middleware owns first-issue. */

export type CsrfFailureReason =
  'missing_origin' | 'origin_not_allowed' | 'missing_cookie' | 'missing_header' | 'token_mismatch';

export interface CsrfResult {
  ok: boolean;
  reason: CsrfFailureReason | null;
}

export function verifyCsrf(request: NextRequest | Request): CsrfResult {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return { ok: true, reason: null };

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin) {
    if (!isOriginAllowed(origin)) return { ok: false, reason: 'origin_not_allowed' };
  } else if (referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return { ok: false, reason: 'origin_not_allowed' };
    }
    if (!isOriginAllowed(refererOrigin)) return { ok: false, reason: 'origin_not_allowed' };
  } else {
    // No origin and no referer on a mutation: refuse. Modern browsers always
    // send Origin for same-origin and cross-origin POSTs.
    return { ok: false, reason: 'missing_origin' };
  }

  const headerToken = request.headers.get(CSRF_HEADER);
  if (!headerToken) return { ok: false, reason: 'missing_header' };

  const cookieToken = readCookie(request.headers.get('cookie'), csrfCookieName());
  if (!cookieToken) return { ok: false, reason: 'missing_cookie' };

  if (!constantTimeEqual(hashToken(headerToken), hashToken(cookieToken))) {
    return { ok: false, reason: 'token_mismatch' };
  }
  return { ok: true, reason: null };
}

export function logCsrfRejection(request: NextRequest | Request, reason: CsrfFailureReason): void {
  auditDetached({
    event: 'auth.csrf_rejected',
    severity: 'warning',
    outcome: 'blocked',
    ip: request.headers.get('cf-connecting-ip'),
    userAgent: request.headers.get('user-agent')?.slice(0, 400) ?? null,
    metadata: { reason, method: request.method, path: safePath(request) },
  });
}

function safePath(request: NextRequest | Request): string {
  try {
    // The path is attacker-influenced, so it is truncated and only ever used as
    // a log discriminator — never echoed in a response body.
    return new URL(request.url).pathname.slice(0, 120);
  } catch {
    return 'unknown';
  }
}
