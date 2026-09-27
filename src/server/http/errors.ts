import 'server-only';

import type { ZodError, ZodType } from 'zod';
import { API_ERROR_STATUS, type ApiErrorCode } from '@/shared/api-error';

/**
 * Application error taxonomy.
 *
 * Every thrown error carries a stable `code` that the API layer maps to an HTTP
 * status and a public message. Anything not in this taxonomy becomes a generic
 * 500 with a correlation id — internal messages, stack traces and driver errors
 * never reach the client.
 */

export type ErrorCode = ApiErrorCode;

const STATUS_BY_CODE: Record<ErrorCode, number> = API_ERROR_STATUS;

export type { ApiErrorCode, ApiErrorBody } from '@/shared/api-error';

/**
 * Generic authentication failure. Register/login/reset all return this exact
 * shape so an attacker cannot distinguish "no such user" from "wrong password".
 */
export const GENERIC_AUTH_ERROR = 'Invalid or expired credentials.';
export const GENERIC_AUTH_CODE = 'unauthorized';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      expose?: boolean;
      details?: Record<string, unknown>;
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.expose = options.expose ?? this.status < 500;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export const badRequest = (message = 'Malformed request.', details?: Record<string, unknown>) =>
  new AppError('bad_request', message, { details });

export const unauthorized = (message = GENERIC_AUTH_ERROR) => new AppError('unauthorized', message);

/**
 * The single failure used by login, logout-of-unknown-session, email
 * verification and password reset. Keeping one factory means an audit of this
 * file proves the message cannot drift between flows.
 */
export const genericAuthFailure = () => new AppError('unauthorized', GENERIC_AUTH_ERROR);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('forbidden', message);

export const notFound = (message = 'Not found.') => new AppError('not_found', message);

export const conflict = (message = 'That resource already exists.') =>
  new AppError('conflict', message);

export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError('too_many_requests', 'Too many requests. Please slow down.', {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });

export const locked = (message = 'This account is temporarily locked.') =>
  new AppError('locked', message);

export const internal = (message = 'Something went wrong.', cause?: unknown) =>
  new AppError('internal_error', message, { expose: false, cause });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/** Flattens a zod error into `{ field: message }` for form rendering. */
export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_root';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export type Validator<T> = ZodType<T>;

/** Parses with a zod schema, converting failures into a 422 AppError. */
export function parseOrThrow<T>(schema: Validator<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('validation_failed', 'The submitted data is invalid.', {
      details: { fields: fieldErrorsFromZod(result.error) },
    });
  }
  return result.data;
}
