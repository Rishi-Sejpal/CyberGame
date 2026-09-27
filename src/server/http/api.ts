import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError, fieldErrorsFromZod, isAppError, type ErrorCode } from './errors';
import { verifyCsrf, logCsrfRejection, type CsrfFailureReason } from '@/server/security/csrf';
import { checkRateLimit, type RateLimitRule, type RateLimitDecision } from '@/server/security/rate-limit';
import { clientIp, deviceLabel, ipIdentity, userAgent } from '@/server/security/request';
import { resolveSession, type SessionUser } from '@/server/security/session';
import { auditDetached } from '@/server/security/audit';
import { isProduction } from '@/server/config/env';

/**
 * The single entry point for every mutating API route.
 *
 * A handler declared through `withApi` gets, in order:
 *   1. a correlation id (also set as a response header),
 *   2. CSRF verification (skipped for GET/HEAD/OPTIONS),
 *   3. an IP rate limit,
 *   4. a resolved session (optional — `auth: false` opts out),
 *   5. the handler itself,
 *   6. uniform error translation, with zero leakage for 5xx.
 *
 * Anything that throws still produces a well-formed JSON body, so a client
 * never has to parse an HTML error page.
 */

export interface ApiContext<S = SessionUser> {
  request: NextRequest;
  params: Record<string, string>;
  session: S | null;
  ip: string | null;
  userAgent: string;
  deviceLabel: string;
  requestId: string;
}

export interface ApiOptions {
  /** Require an authenticated session. Default `true`. */
  auth?: boolean;
  /** Minimum role for the route. Implies `auth: true`. */
  roles?: Array<SessionUser['role']>;
  /** Applied before the handler runs. */
  rateLimit?: RateLimitRule;
  /** Override the rate-limit identity (e.g. per-account instead of per-IP). */
  rateLimitKey?: (ctx: { request: NextRequest; ip: string | null }) => string;
  /** Disable CSRF (only for genuinely idempotent, unauthenticated GET-ish reads). */
  skipCsrf?: boolean;
  /** Human label used in audit entries. */
  auditAction?: string;
}

export type ApiHandler<S> = (ctx: ApiContext<S>) => Promise<Response> | Response;

export function withApi<S = SessionUser>(handler: ApiHandler<S>, options: ApiOptions = {}) {
  const requireAuth = options.auth ?? true;
  const allowedRoles = options.roles;

  return async function route(
    request: NextRequest,
    routeContext?: { params: Promise<Record<string, string>> },
  ): Promise<Response> {
    const requestId = randomUUID();
    const ip = clientIp(request);
    const ua = userAgent(request);

    try {
      if (!options.skipCsrf) {
        const csrf = verifyCsrf(request);
        if (!csrf.ok) {
          logCsrfRejection(request, csrf.reason as CsrfFailureReason);
          return fail({
            status: 403,
            code: 'csrf_rejected',
            message: csrfMessage(csrf.reason),
            requestId,
          });
        }
      }

      if (options.rateLimit) {
        const identity = options.rateLimitKey
          ? options.rateLimitKey({ request, ip })
          : ipIdentity(request);
        const decision = checkRateLimit(options.rateLimit, identity);
        if (!decision.allowed) {
          auditDetached({
            event: 'auth.rate_limited',
            severity: 'warning',
            outcome: 'blocked',
            ip,
            userAgent: ua,
            metadata: { rule: options.rateLimit.name, path: pathOf(request), requestId },
          });
          return rateLimited(decision, requestId);
        }
      }

      let session: SessionUser | null = null;
      if (requireAuth || allowedRoles) {
        const resolved = await resolveSession();
        session = resolved?.user ?? null;
        if (!session) {
          return fail({
            status: 401,
            code: 'unauthorized',
            message: 'You must be signed in to do that.',
            requestId,
          });
        }
        if (allowedRoles && !allowedRoles.includes(session.role)) {
          auditDetached({
            event: 'game.unauthorized_access',
            severity: 'warning',
            outcome: 'blocked',
            userId: session.id,
            ip,
            userAgent: ua,
            metadata: { path: pathOf(request), required: allowedRoles, actual: session.role, requestId },
          });
          return fail({
            status: 403,
            code: 'forbidden',
            message: 'You do not have access to this resource.',
            requestId,
          });
        }
      }

      const params = routeContext?.params ? await routeContext.params : {};

      const ctx: ApiContext<S> = {
        request,
        params,
        session: session as S | null,
        ip,
        userAgent: ua,
        deviceLabel: deviceLabel(request),
        requestId,
      };

      const response = await handler(ctx);
      response.headers.set('X-Request-Id', requestId);
      response.headers.set('Cache-Control', 'no-store, max-age=0');
      return response;
    } catch (error) {
      return handleError(error, { requestId, path: pathOf(request), ip, userAgent: ua });
    }
  };
}

function csrfMessage(reason: string | null): string {
  switch (reason) {
    case 'missing_origin':
      return 'Missing request origin. Send requests from the application origin.';
    case 'origin_not_allowed':
      return 'Request origin is not permitted.';
    case 'missing_cookie':
      return 'Missing CSRF cookie. Refresh the page and try again.';
    case 'missing_header':
      return 'Missing CSRF header.';
    default:
      return 'CSRF validation failed.';
  }
}

export function pathOf(request: NextRequest): string {
  try {
    return new URL(request.url).pathname.slice(0, 160);
  } catch {
    return 'unknown';
  }
}

function fail(input: {
  status: number;
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Response {
  return NextResponse.json(
    { error: { code: input.code, message: input.message, requestId: input.requestId, ...(input.details ? { details: input.details } : {}) } },
    { status: input.status, headers: { 'X-Request-Id': input.requestId, ...(input.headers ?? {}) } },
  );
}

function rateLimited(decision: RateLimitDecision, requestId: string): Response {
  return NextResponse.json(
    {
      error: {
        code: 'too_many_requests',
        message: 'Too many requests. Please slow down and try again shortly.',
        requestId,
        retryAfter: decision.retryAfter,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, decision.retryAfter)),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(Math.ceil(decision.resetAt / 1000)),
        'X-Request-Id': requestId,
      },
    },
  );
}

function handleError(
  error: unknown,
  ctx: { requestId: string; path: string; ip: string | null; userAgent: string | null },
): Response {
  if (isAppError(error)) {
    if (error.status >= 500) {
      console.error('[api] server error', {
        requestId: ctx.requestId,
        path: ctx.path,
        code: error.code,
        error: error.message,
        cause: error.cause instanceof Error ? error.cause.message : error.cause,
      });
      return fail({
        status: error.status,
        code: error.code,
        message: 'Something went wrong on our side.',
        requestId: ctx.requestId,
        headers: error.headers,
      });
    }
    return fail({
      status: error.status,
      code: error.code,
      message: error.message,
      requestId: ctx.requestId,
      details: error.details,
      headers: error.headers,
    });
  }

  if (error instanceof ZodError) {
    return fail({
      status: 422,
      code: 'validation_failed',
      message: 'The submitted data is invalid.',
      requestId: ctx.requestId,
      details: { fields: fieldErrorsFromZod(error) },
    });
  }

  // Duplicate key from Mongo — surface as a conflict, never as a 500.
  const mongoCode = (error as { code?: number } | null)?.code;
  if (mongoCode === 11000) {
    return fail({
      status: 409,
      code: 'conflict',
      message: 'That resource already exists.',
      requestId: ctx.requestId,
    });
  }

  console.error('[api] unhandled error', {
    requestId: ctx.requestId,
    path: ctx.path,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
  });

  auditDetached({
    event: 'system.error',
    severity: 'critical',
    outcome: 'failure',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { path: ctx.path, requestId: ctx.requestId },
  });

  return fail({
    status: 500,
    code: 'internal_error',
    // Uniform message: never the driver error, never the stack.
    message: isProduction()
      ? 'Something went wrong on our side.'
      : 'Something went wrong on our side. See the server logs for the correlation id.',
    requestId: ctx.requestId,
  });
}

// ---------------------------------------------------------------------------
// Success helpers
// ---------------------------------------------------------------------------

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return NextResponse.json({ data }, { status: 200, ...init });
}

export function created<T>(data: T, init: ResponseInit = {}): Response {
  return NextResponse.json({ data }, { status: 201, ...init });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export { AppError };
