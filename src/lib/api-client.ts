'use client';

import {
  fieldErrorsOf,
  isApiErrorBody,
  type ApiEnvelope,
  type ApiErrorBody,
  type ApiErrorCode,
  type FieldErrors,
} from '@/shared/api-error';

/**
 * The browser's only door to the API.
 *
 * Everything a Client Component needs to know about HTTP lives here, which means
 * no component ever touches `fetch`, `credentials`, headers, or a status code.
 * Four responsibilities:
 *
 *  1. **CSRF.** Every mutating call gets the double-submit `x-csrf-token`
 *     header, read from the readable CSRF cookie. If the cookie is missing we
 *     fail with a clear, retryable error instead of firing a request the server
 *     will reject as a forgery — which would look to the player like a bug.
 *  2. **Credentials.** `same-origin` so the session cookie rides along and is
 *     never sent to a third party.
 *  3. **Timeouts.** A hung request would leave a form permanently disabled.
 *     Every call gets an `AbortSignal` and maps a timeout to a distinct error.
 *  4. **Error normalisation.** `ApiRequestError` is the only error type a form
 *     has to handle, and it always carries a message that is safe to render.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type TransportFailure = 'timeout' | 'network' | 'aborted' | 'missing_csrf';

export interface ApiRequestErrorInit {
  status: number;
  body: ApiErrorBody | null;
  /** Set when the request never produced a usable HTTP response. */
  transport?: TransportFailure;
  /** Raw `Retry-After`, used when the body omitted it (a proxy stripped JSON). */
  retryAfterHeader?: string | null;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'client_error';
  readonly requestId: string | null;
  readonly fieldErrors: FieldErrors;
  readonly retryAfter: number | null;
  readonly transport: TransportFailure | undefined;

  constructor(message: string, init: ApiRequestErrorInit) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = init.status;
    this.code = init.body?.code ?? 'client_error';
    this.requestId = init.body?.requestId ?? null;
    this.fieldErrors = fieldErrorsOf(init.body ?? undefined);
    this.retryAfter = init.body?.retryAfter ?? parseRetryAfter(init.retryAfterHeader);
    this.transport = init.transport;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    if (this.transport) return this.transport === 'timeout' || this.transport === 'network';
    return this.status === 429 || this.status >= 500;
  }

  /** The first field message, for a compact form-level banner. */
  get firstFieldError(): string | undefined {
    const values = Object.values(this.fieldErrors);
    return values.length > 0 ? values[0] : undefined;
  }
}

function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - Date.now()) / 1000));
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. `undefined` sends no body at all. */
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * The CSRF cookie name is deployment configuration, so the server hands it to
 * the client rather than the client hard-coding it. `AuthProvider` calls
 * `configureApiClient` with the value it received from a Server Component; the
 * default only exists so a bare unit test or a non-auth page still works.
 */
const DEFAULT_CSRF_COOKIE_NAME = 'cg_csrf';
let csrfCookieName = DEFAULT_CSRF_COOKIE_NAME;

export function configureApiClient(options: { csrfCookieName?: string }): void {
  const next = options.csrfCookieName?.trim();
  // Guard the shape: a value that could never appear in a cookie is a bug in
  // configuration, and silently falling back hides it.
  if (next && /^[A-Za-z0-9_-]{1,64}$/.test(next)) csrfCookieName = next;
}

export function currentCsrfCookieName(): string {
  return csrfCookieName;
}

/** Test hook. Restores the deployment default. */
export function resetApiClientForTests(): void {
  csrfCookieName = DEFAULT_CSRF_COOKIE_NAME;
}

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== csrfCookieName) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: string | undefined;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (!SAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (!token) {
      // The edge middleware arms this cookie on the very first page view. If it
      // is genuinely absent the page was rendered without middleware (a raw API
      // probe, or a stripped proxy), and the write would be refused anyway.
      throw new ApiRequestError('Your security token is missing. Refresh the page and try again.', {
        status: 0,
        body: null,
        transport: 'missing_csrf',
      });
    }
    headers['x-csrf-token'] = token;
  }

  // A caller-supplied signal and our own timeout must both abort the request.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ApiRequestError('Request cancelled.', {
        status: 0,
        body: null,
        transport: 'aborted',
      });
    }
    if (isTimeout(error, controller.signal)) {
      throw new ApiRequestError('The server took too long to respond. Try again.', {
        status: 0,
        body: null,
        transport: 'timeout',
      });
    }
    throw new ApiRequestError('Could not reach the server. Check your connection.', {
      status: 0,
      body: null,
      transport: 'network',
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }

  const envelope = await readEnvelope(response);

  if (!response.ok) {
    throw new ApiRequestError(envelope?.error?.message ?? `Request failed (${response.status}).`, {
      status: response.status,
      body: envelope?.error ?? null,
      retryAfterHeader: response.headers.get('retry-after'),
    });
  }

  return (envelope?.data ?? null) as T;
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  // Safari and older engines do not carry the abort reason through.
  return signal.aborted && !(error instanceof DOMException && error.name === 'AbortError');
}

/**
 * Parses the envelope defensively.
 *
 * A proxy or a crashed handler can return HTML or an empty body. Returning
 * `null` lets the caller produce a generic message instead of throwing a
 * `SyntaxError` from `JSON.parse` that nobody would recognise as a network
 * problem.
 */
async function readEnvelope(response: Response): Promise<ApiEnvelope<unknown> | null> {
  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { data?: unknown; error?: unknown };
  if (isApiErrorBody(candidate.error)) {
    return { error: candidate.error } as ApiEnvelope<unknown>;
  }
  if ('data' in candidate) return { data: candidate.data } as ApiEnvelope<unknown>;
  return null;
}

/** Normalises anything thrown by a form handler into a renderable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.firstFieldError ?? error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
