import { NextRequest } from 'next/server';
import { readCookie } from '@/server/security/cookies';

/**
 * Builds a `NextRequest` suitable for driving a route handler in tests.
 *
 * The CSRF pair is generated together so `verifyCsrf` passes by default; call
 * `csrf: 'invalid'` or omit it to exercise the rejection path.
 */
export function buildRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    origin?: string | null;
    csrf?: 'valid' | 'invalid' | 'none';
    ip?: string;
  } = {},
): NextRequest {
  const method = init.method ?? 'POST';
  const url = path.startsWith('http') ? path : `http://localhost:3000${path}`;

  const cookiePairs: string[] = [];
  const csrfMode = init.csrf ?? 'valid';
  const csrfValue = 'test-csrf-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  if (csrfMode !== 'none') {
    cookiePairs.push(`cg_csrf=${csrfMode === 'valid' ? csrfValue : 'other-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}`);
  }
  for (const [name, value] of Object.entries(init.cookies ?? {})) {
    cookiePairs.push(`${name}=${value}`);
  }

  const headers = new Headers(init.headers ?? {});
  headers.set('cookie', cookiePairs.join('; '));
  headers.set('content-type', 'application/json');
  if (init.origin !== null) {
    headers.set('origin', init.origin ?? 'http://localhost:3000');
  }
  headers.set('user-agent', 'CyberGridTest/1.0 (vitest)');
  if (init.ip) headers.set('x-real-ip', init.ip);
  if (csrfMode === 'valid') headers.set('x-csrf-token', csrfValue);
  else if (csrfMode === 'invalid') headers.set('x-csrf-token', 'mismatched-token-cccccccccccccccccccccccccccccccc');

  const hasBody = method !== 'GET' && method !== 'HEAD' && init.body !== undefined;

  return new NextRequest(url, {
    method,
    headers,
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** Pulls the CSRF token out of a response's `set-cookie` headers. */
export function csrfFromResponse(response: Response): string | null {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const value = readCookie(cookie, 'cg_csrf');
    if (value) return value;
  }
  return null;
}

/** Pulls the session cookie out of a response's `set-cookie` headers. */
export function sessionFromResponse(response: Response): string | null {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const value = readCookie(cookie, 'cg_session');
    if (value) return value;
  }
  return null;
}

export async function readJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export interface ApiEnvelope<T> {
  data?: T;
  error?: { code: string; message: string; requestId?: string; details?: Record<string, unknown> };
}
