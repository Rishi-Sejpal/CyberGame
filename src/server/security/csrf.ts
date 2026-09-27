import 'server-only';

import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { cookiesAreSecure, env, isOriginAllowed } from '@/server/config/env';
import { constantTimeEqual, generateSecret, hashToken } from './crypto';
import { auditDetached } from './audit';

/**
 * CSRF protection — defence in depth, three independent layers.
 *
 * 1. **SameSite=Lax session cookie.** A cross-site `POST` will not carry it, so
 *    the request is already unauthenticated. This alone blocks classic CSRF.
 * 2. **Origin/Referer allowlist.** Every mutating request must present an
 *    `Origin` (or, for older clients, a `Referer`) inside the configured set.
 *    A missing `Origin` on a state-changing request is rejected outright.
 * 3. **Double-submit CSRF token.** A readable, non-`HttpOnly` cookie is paired
 *    with an `x-csrf-token` header; the header must match the cookie. Because
 *    layer 1 already blocks cross-site delivery, this layer exists to stop
 *    same-site subdomain takeover and any future same-origin injection.
 *
 * Why not rely on tokens alone? Because a pure custom-header scheme breaks
 * plain `<form>` submissions and requires JS on every write. Why not rely on
 * SameSite alone? Because SameSite semantics have historically differed across
 * browsers and `null` origins. Belt, braces, and a lock.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Issues (or re-arms) the double-submit token. Idempotent per browser session.
 * The cookie is intentionally NOT HttpOnly — that is the entire point of a
 * double-submit pattern — but it carries no authority on its own.
 */
export async function ensureCsrfToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(env().CSRF_COOKIE_NAME)?.value;
  if (existing && existing.length >= 32) return existing;

  const token = generateSecret(32);
  jar.set(env().CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: cookiesAreSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: env().SESSION_TTL_HOURS * 3_600,
  });
  return token;
}

export type CsrfFailureReason =
  | 'method_not_mutating'
  | 'missing_origin'
  | 'origin_not_allowed'
  | 'missing_cookie'
  | 'missing_header'
  | 'token_mismatch';

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
    try {
      if (!isOriginAllowed(new URL(referer).origin)) return { ok: false, reason: 'origin_not_allowed' };
    } catch {
      return { ok: false, reason: 'origin_not_allowed' };
    }
  } else {
    // No origin and no referer on a mutation: refuse. Browsers always send
    // Origin for cross-origin and same-origin POSTs in modern versions.
    return { ok: false, reason: 'missing_origin' };
  }

  const headerToken = request.headers.get(CSRF_HEADER);
  if (!headerToken) return { ok: false, reason: 'missing_header' };

  // Next's `cookies()` is not readable synchronously inside middleware, so the
  // cookie is read from the incoming request headers directly.
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieToken = readCookie(cookieHeader, env().CSRF_COOKIE_NAME);
  if (!cookieToken) return { ok: false, reason: 'missing_cookie' };

  if (!constantTimeEqual(hashToken(headerToken), hashToken(cookieToken))) {
    return { ok: false, reason: 'token_mismatch' };
  }
  return { ok: true, reason: null };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
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
    // The path is attacker-influenced, so it is truncated and never echoed back
    // in a response body — it exists only as a log discriminator.
    return new URL(request.url).pathname.slice(0, 120);
  } catch {
    return 'unknown';
  }
}
