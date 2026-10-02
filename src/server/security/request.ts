import 'server-only';

import type { NextRequest } from 'next/server';

/**
 * Request metadata extraction.
 *
 * Client IP handling is the single most over-trusted detail in web apps, so
 * this module is deliberately paranoid:
 *
 *  - EVERY proxy-supplied IP header is ONLY honoured when the operator has
 *    declared that the app sits behind a trusted proxy (`TRUST_PROXY=1`).
 *    Otherwise a client can spoof its own IP and walk straight past per-IP rate
 *    limits. This includes the edge-specific headers (`cf-connecting-ip`,
 *    `fly-client-ip`): they are just as client-settable as `x-forwarded-for`
 *    when the app is not actually behind that edge, so trusting them
 *    unconditionally would hand every attacker an unlimited supply of fresh
 *    rate-limit buckets.
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
  // A dotted value that is not a valid IPv4 is not an IPv6 address either, so it
  // must not be waved through by the character-class check: that is what used to
  // let `1.2.3.4:80` be recorded as a client IP. Rejecting it here keeps the rate
  // limit key and the audit log holding something that at least looks like an
  // address.
  if (value.includes('.')) return false;
  return value.includes(':') && IPV6_CHARS.test(value);
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

    // Cloudflare / Fly.io edge headers. Trustworthy *only* when the operator has
    // confirmed the app is actually served by that edge — which is exactly what
    // `TRUST_PROXY=1` asserts. Reading them otherwise would let a client pick
    // its own rate-limit identity, e.g. by sending a new `cf-connecting-ip` on
    // every request, which defeats login, register and password-reset limits.
    const direct = headers.get('cf-connecting-ip')?.trim() ?? headers.get('fly-client-ip')?.trim();
    if (direct && looksLikeIp(direct)) return direct;
  }

  // Next's request.ip was removed in 15; on a bare Node server the socket is
  // not reachable from a Request object, so `null` is the honest answer.
  return null;
}

/**
 * Rate-limit identity for a request.
 *
 * When no trustworthy client IP is available this collapses to a single shared
 * `unknown` bucket. That is deliberate: it fails *closed* (one noisy client
 * throttles everyone rather than one client escaping every limit), and it is
 * strictly better than the previous behaviour, where a client could choose its
 * own bucket with a forged header. Deployments that need per-client limits must
 * run behind a trusted proxy and set `TRUST_PROXY=1`.
 */
export function ipIdentity(request: NextRequest | Request): string {
  return clientIp(request) ?? 'unknown';
}

export function userAgent(request: NextRequest | Request): string {
  return (request.headers.get('user-agent') ?? 'unknown').slice(0, 400);
}

/** Short, human-recognisable device label for the "your sessions" screen. */
export function deviceLabel(request: NextRequest | Request): string {
  const ua = userAgent(request);
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /chrome|crios/i.test(ua)
        ? 'Chrome'
        : /firefox|fxios/i.test(ua)
          ? 'Firefox'
          : /safari/i.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /mac os|macintosh/i.test(ua)
      ? 'macOS'
      : /android/i.test(ua)
        ? 'Android'
        : /iphone|ipad|ios/i.test(ua)
          ? 'iOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}

export function requestOrigin(request: NextRequest | Request): string | null {
  return request.headers.get('origin');
}

/** WebSocket upgrade requests have no Origin in some browsers; guard accordingly. */
export function clientLocale(request: NextRequest | Request): string {
  const header = request.headers.get('accept-language');
  if (!header) return 'en';
  const first = header.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? 'en';
  return /^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(first) ? first : 'en';
}
