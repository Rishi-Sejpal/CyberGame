import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  apiFetch,
  configureApiClient,
  currentCsrfCookieName,
  errorMessage,
  readCsrfToken,
  resetApiClientForTests,
} from '@/lib/api-client';

/**
 * Transport behaviour of the browser's only door to the API.
 *
 * `fetch` is stubbed and `document.cookie` is faked, so these are the cases that
 * decide what a player sees when the network misbehaves: a hung request, a proxy
 * that returns HTML, a missing CSRF cookie, a double-clicked form. None of that
 * is reachable from a Node test otherwise, and all of it is exactly where a
 * client SDK hides its bugs.
 */

const CSRF = 'token-abc123';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function stubCookie(value: string): void {
  vi.stubGlobal('document', { cookie: value });
}

/**
 * Awaits a call that must reject and hands back the typed error.
 *
 * `.catch((e) => e)` leaves the result as `unknown`, which then needs a cast at
 * every assertion site; this keeps the cast in one place and additionally fails
 * if the request unexpectedly succeeded.
 */
async function failure(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiRequestError;
  }
  throw new Error('expected the request to fail, but it resolved');
}

/** The `RequestInit` the client built, with headers narrowed to the plain object it passes. */
interface CapturedRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Reads back what was handed to `fetch`, most recent call first. */
function lastRequest(): CapturedRequest {
  const call = fetchMock.mock.calls.at(-1)!;
  return { url: call[0] as string, init: call[1] as CapturedRequest['init'] };
}

beforeEach(() => {
  resetApiClientForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  stubCookie(`cg_csrf=${CSRF}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiClientForTests();
});

describe('CSRF cookie handling', () => {
  it('reads the token from the configured cookie', () => {
    expect(readCsrfToken()).toBe(CSRF);
  });

  it('ignores other cookies and surrounding whitespace', () => {
    stubCookie(`theme=dark; cg_csrf=${CSRF} ; locale=en`);
    expect(readCsrfToken()).toBe(CSRF);
  });

  it('percent-decodes the value and tolerates a malformed escape', () => {
    stubCookie('cg_csrf=a%20b');
    expect(readCsrfToken()).toBe('a b');
    // A proxy that rewrites cookies can produce an undecodable value; returning
    // the raw text is better than throwing out of a cookie read.
    stubCookie('cg_csrf=%E0%A4%A');
    expect(readCsrfToken()).toBe('%E0%A4%A');
  });

  it('returns null when the cookie is absent or there is no document', () => {
    stubCookie('theme=dark');
    expect(readCsrfToken()).toBeNull();
    vi.stubGlobal('document', undefined);
    expect(readCsrfToken()).toBeNull();
  });

  it('takes the cookie name from deployment config', () => {
    configureApiClient({ csrfCookieName: 'cg_xsrf' });
    expect(currentCsrfCookieName()).toBe('cg_xsrf');
    stubCookie('cg_xsrf=other');
    expect(readCsrfToken()).toBe('other');
  });

  it('refuses a cookie name that could never be a real cookie', () => {
    // Silently accepting a bad name would fail every write in production with a
    // confusing "security token is missing".
    for (const name of ['has space', 'semi;colon', 'a'.repeat(65), '']) {
      configureApiClient({ csrfCookieName: name });
      expect(currentCsrfCookieName()).toBe('cg_csrf');
    }
  });
});

describe('request shape', () => {
  it('sends credentials same-origin and bypasses the cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
    await apiFetch('/api/auth/me');
    const { url, init } = lastRequest();
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.headers['x-csrf-token']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('attaches the double-submit header to every mutating call', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      fetchMock.mockResolvedValue(jsonResponse(200, { data: { ok: true } }));
      await apiFetch('/api/profile', { method, body: { displayName: 'Ada' } });
      const { init } = lastRequest();
      expect(init.headers['x-csrf-token']).toBe(CSRF);
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe('{"displayName":"Ada"}');
    }
  });

  it('refuses a mutation when the CSRF cookie is missing, without hitting the network', async () => {
    // The edge arms this cookie on the first page view, so a miss means the page
    // was served without middleware. Firing the request anyway would produce a
    // 403 the player cannot act on.
    stubCookie('theme=dark');
    const error = await failure(apiFetch('/api/auth/login', { method: 'POST', body: {} }));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.transport).toBe('missing_csrf');
    expect(error.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unwraps the data envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { username: 'ada' } }));
    await expect(apiFetch('/api/auth/me')).resolves.toEqual({ username: 'ada' });
  });

  it('returns null for 204 and for an empty body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/profile', { method: 'DELETE' })).resolves.toBeNull();
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    await expect(apiFetch('/api/profile')).resolves.toBeNull();
  });
});

describe('error normalisation', () => {
  it('carries the code, request id, fields and retry hint from a failure body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        422,
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            requestId: 'req_abc123',
            details: { fields: { password: 'Too short.' } },
          },
        },
        { 'retry-after': '30' },
      ),
    );

    const error = await failure(apiFetch('/api/auth/register', { method: 'POST', body: {} }));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_failed');
    expect(error.requestId).toBe('req_abc123');
    expect(error.fieldErrors).toEqual({ password: 'Too short.' });
    expect(error.retryAfter).toBe(30);
    expect(error.retryable).toBe(false);
  });

  it('falls back to the header when the body omits the hint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        429,
        { error: { code: 'too_many_requests', message: 'Slow down.', requestId: 'req_1' } },
        { 'retry-after': '45' },
      ),
    );
    const error = await failure(apiFetch('/api/auth/login', { method: 'POST', body: {} }));
    expect(error.retryAfter).toBe(45);
    expect(error.retryable).toBe(true);
  });

  it('reads an HTTP-date retry hint', async () => {
    const when = new Date(Date.now() + 60_000).toUTCString();
    fetchMock.mockResolvedValue(
      jsonResponse(
        429,
        { error: { code: 'too_many_requests', message: 'Slow down.', requestId: 'req_1' } },
        { 'retry-after': when },
      ),
    );
    const error = await failure(apiFetch('/api/auth/login', { method: 'POST', body: {} }));
    expect(error.retryAfter).toBeGreaterThan(50);
    expect(error.retryAfter).toBeLessThanOrEqual(60);
  });

  it('ignores an unparseable retry hint rather than showing NaN to a form', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        429,
        { error: { code: 'too_many_requests', message: 'Slow down.', requestId: 'req_1' } },
        { 'retry-after': 'soon' },
      ),
    );
    const error = await failure(apiFetch('/api/auth/login', { method: 'POST', body: {} }));
    expect(error.retryAfter).toBeNull();
  });

  it('survives an HTML error page from a proxy', async () => {
    // A 502 from a reverse proxy is HTML. Parsing it must not throw a
    // SyntaxError the form would render as a blank state.
    fetchMock.mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const error = await failure(apiFetch('/api/auth/login', { method: 'POST', body: {} }));
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.message).toBe('Request failed (502).');
    expect(error.code).toBe('client_error');
    expect(error.retryable).toBe(true);
  });

  it('survives a JSON array or a bare scalar where an envelope was expected', async () => {
    for (const body of [[1, 2, 3], 'ok', 42, true]) {
      fetchMock.mockResolvedValue(jsonResponse(200, body));
      await expect(apiFetch('/api/auth/me')).resolves.toBeNull();
    }
  });

  it('treats a 5xx and a 429 as retryable and a 4xx as final', async () => {
    const cases: Array<[number, boolean]> = [
      [400, false],
      [401, false],
      [403, false],
      [404, false],
      [409, false],
      [422, false],
      [423, false],
      [429, true],
      [500, true],
      [503, true],
    ];
    for (const [status, retryable] of cases) {
      fetchMock.mockResolvedValue(
        jsonResponse(status, { error: { code: 'bad_request', message: 'x', requestId: 'r' } }),
      );
      const error = await failure(apiFetch('/api/x'));
      expect([status, error.retryable]).toEqual([status, retryable]);
    }
  });
});

describe('transport failures', () => {
  it('reports an unreachable server as a retryable network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await failure(apiFetch('/api/auth/me'));
    expect(error.transport).toBe('network');
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('connection');
  });

  it('aborts a hung request and says so instead of spinning forever', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    const error = await failure(apiFetch('/api/auth/me', { timeoutMs: 5 }));
    expect(error.transport).toBe('timeout');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('too long');
  });

  it('reports a caller-initiated cancel as cancelled, not as a failure', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = apiFetch('/api/auth/me', { signal: controller.signal });
    controller.abort();
    const error = await failure(pending);
    // A cancel is the player's own doing, so it must not be presented as a
    // "try again" failure or disable the form they just navigated away from.
    expect(error.transport).toBe('aborted');
    expect(error.retryable).toBe(false);
  });
});

describe('renderable messages', () => {
  it('prefers the first field message over the summary', () => {
    const error = new ApiRequestError('Check the highlighted fields.', {
      status: 422,
      body: {
        code: 'validation_failed',
        message: 'Check the highlighted fields.',
        requestId: 'req_1',
        details: { fields: { email: 'Enter a valid email address.' } },
      },
    });
    expect(errorMessage(error)).toBe('Enter a valid email address.');
  });

  it('falls back to the summary, then to a generic line', () => {
    expect(
      errorMessage(new ApiRequestError('Too many attempts.', { status: 429, body: null })),
    ).toBe('Too many attempts.');
    expect(errorMessage('a string')).toBe('Something went wrong. Try again.');
    expect(errorMessage(null)).toBe('Something went wrong. Try again.');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
