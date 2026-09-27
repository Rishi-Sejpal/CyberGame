import 'server-only';

import type { NextRequest } from 'next/server';
import { env, isProduction } from '@/server/config/env';

/**
 * Request metadata extraction.
 *
 * Client IP handling is the single most over-trusted detail in web apps, so
 * this module is deliberately paranoid:
 *
 *  - `x-forwarded-for` is ONLY honoured when the operator has declared that the
 *    app sits behind a trusted proxy (`TRUST_PROXY=1`). Otherwise a client can
 *    spoof its own IP and walk straight past per-IP rate limits.
 *  - When trusted, only the *first* hop is used, because that is the only entry
 *    the edge actually wrote. The rest of the chain is client-controllable.
 *  - The value is validated to look like an IP, so a garbage header cannot
 *    poison log aggregation with newlines or megabytes of text.
 */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_CHARS = /^[0-9a-f:.]{2,45}$/i;

function trustProxy(): boolean {
  return process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
}

function looksLikeIp(value: string): boolean {
  if (IPV4.test(value)) return true;
  return value.includes(':') && IPV6_CHARS.test(value) && /^[0-9a-f:.]+$/i.test(value);
}

/** Best-effort client IP, or `null`. Never throws. */
export function clientIp(request: NextRequest | Request): string | null {
  const headers = request.headers;

  if (trustProxy()) {
    const xff = headers.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first && looksLikeIp(first)) return first;
    }
    const real = headers.get('x-real-ip')?.trim();
    if (real && looksLikeIp(real)) return real;
  }

  const direct = headers.get('cf-connecting-ip')?.trim() ?? headers.get('fly-client-ip')?.trim();
  if (direct && looksLikeIp(direct)) return direct;

  // Next's request.ip was removed in 15; on a bare Node server the socket is
  // not reachable from a Request object, so `null` is the honest answer.
  return null;
}

export function ipIdentity(request: NextRequest | Request): string {
  return clientIp(request) ?? 'unknown';
}

export function userAgent(request: NextRequest | Request): string {
  return (request.headers.get('user-agent') ?? 'unknown').slice(0, 400);
}

/** Short, human-recognisable device label for the "your sessions" screen. */
export function deviceLabel(request: NextRequest | Request): string {
  const ua = userAgent(request);
  const browser =
    /edg\//i.test(ua) ? 'Edge'
    : /opr\/|opera/i.test(ua) ? 'Opera'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /safari/i.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /windows/i.test(ua) ? 'Windows'
    : /mac os|macintosh/i.test(ua) ? 'macOS'
    : /android/i.test(ua) ? 'Android'
    : /iphone|ipad|ios/i.test(ua) ? 'iOS'
    : /linux/i.test(ua) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

export function requestOrigin(request: NextRequest | Request): string | null {
  return request.headers.get('origin');
}

/** WebSocket upgrade requests have no Origin in some browsers; guard accordingly. */
export function isSecureRequest(request: NextRequest | Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]?.trim() === 'https';
  return new URL(env().APP_URL).protocol === 'https:' || !isProduction();
}

export function clientLocale(request: NextRequest | Request): string {
  const header = request.headers.get('accept-language');
  if (!header) return 'en';
  const first = header.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? 'en';
  return /^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(first) ? first : 'en';
}
