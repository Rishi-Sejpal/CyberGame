/**
 * Framework-agnostic cookie handling.
 *
 * Why this exists instead of calling `next/headers`' `cookies()` everywhere:
 *
 *  1. `cookies()` only works inside Next's async request scope, which makes
 *     every service that touches a cookie impossible to unit-test and impossible
 *     to call from a background job or a script.
 *  2. Writing cookies through an ambient API hides *where* the cookie lands. An
 *     explicit jar makes the response object the single obvious target.
 *  3. A hand-rolled serialiser lets us guarantee the attributes that matter
 *     (`HttpOnly`, `SameSite`, `Secure`, `Path`) are always present, instead of
 *     depending on a caller remembering them.
 *
 * Route handlers create a jar bound to the request, pass it down, and `withApi`
 * applies the pending cookies onto the final response.
 */

export type SameSite = 'lax' | 'strict' | 'none';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
  path?: string;
  maxAge?: number;
  domain?: string;
  expires?: Date;
}

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string, options?: CookieOptions): void;
  /** Cookies queued for writing, in insertion order. */
  pending(): ReadonlyArray<{ name: string; value: string; options: CookieOptions }>;
  /** Copies queued cookies onto a response as `Set-Cookie` headers. */
  applyTo(response: Response): void;
}

const NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

export function isValidCookieName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && NAME_RE.test(name);
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!isValidCookieName(name)) {
    throw new Error(`Refusing to set a cookie with an invalid name: ${JSON.stringify(name)}`);
  }
  const parts = [`${name}=${encodeURIComponent(value)}`];

  // `Secure` is implied by SameSite=None per the cookie spec.
  const secure = options.secure ?? false;
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${capitalize(options.sameSite)}`);
  if (secure) parts.push('Secure');

  return parts.join('; ');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function serializeDeletion(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAge: 0, expires: new Date(0) });
}

export interface ReadableCookieSource {
  get(name: string): { value: string } | undefined;
}

/**
 * A jar that reads from an existing cookie source and buffers writes.
 * Works with `NextRequest.cookies`, `RequestCookies`, and the test helper.
 */
export function createCookieJar(source?: ReadableCookieSource): CookieJar {
  const writes: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const deletions: Array<{ name: string; options: CookieOptions }> = [];

  return {
    get(name) {
      return source?.get(name)?.value;
    },
    set(name, value, options = {}) {
      writes.push({ name, value, options });
    },
    delete(name, options = {}) {
      deletions.push({ name, options });
    },
    pending() {
      return writes;
    },
    applyTo(response) {
      for (const cookie of writes) {
        response.headers.append(
          'Set-Cookie',
          serializeCookie(cookie.name, cookie.value, cookie.options),
        );
      }
      for (const cookie of deletions) {
        response.headers.append('Set-Cookie', serializeDeletion(cookie.name, cookie.options));
      }
    },
  };
}

/** Parses a raw `Cookie:` header. Used by the edge middleware. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * A source backed by Next's `cookies()` store.
 *
 * In a Server Component there is no `Request` object, so the raw `Cookie:`
 * header is not reachable — and Next does **not** expose a synthetic `cookie`
 * entry to stand in for it. `store.get('cookie')` returns `undefined`, which
 * means a jar built that way silently reads nothing and every session lookup
 * fails. Read the individual cookies by name instead.
 *
 * Typed structurally rather than as `ReadonlyRequestCookies` so this module
 * stays framework-agnostic and importable from the edge.
 */
export function cookieSourceFromStore(store: {
  get(name: string): { value: string } | undefined;
}): ReadableCookieSource {
  return {
    get(name) {
      const cookie = store.get(name);
      return cookie === undefined ? undefined : { value: cookie.value };
    },
  };
}

/** A source backed by a raw `Cookie:` header string. */
export function cookieSourceFromHeader(header: string | null | undefined): ReadableCookieSource {
  return {
    get(name) {
      const value = readCookie(header, name);
      return value === null ? undefined : { value };
    },
  };
}
