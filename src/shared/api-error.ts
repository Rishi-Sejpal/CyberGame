/**
 * The wire contract between the API and the browser.
 *
 * These types are imported by both sides. `src/server/http/errors.ts` derives
 * its `AppError` status codes from `API_ERROR_STATUS` and re-exports the code
 * union, so a new error code cannot be added on the server without the client
 * failing to typecheck.
 *
 * Shape rules, enforced by convention and asserted in `tests/api-contract.test.ts`:
 *  - Success: `{ data: T }`
 *  - Failure: `{ error: { code, message, requestId, details? } }`
 *  - `message` is always safe to render. Internal detail lives in `details`
 *    only when the endpoint has explicitly decided the caller may see it.
 *  - `requestId` is always present so a report can be correlated with the audit
 *    log. It is never used for control flow on the client.
 */

export const API_ERROR_STATUS = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  too_many_requests: 429,
  csrf_rejected: 403,
  locked: 423,
  internal_error: 500,
  service_unavailable: 503,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Correlates with the server log and the audit trail. */
  requestId: string;
  /** Field-level messages, e.g. `{ password: "Password must be at least 12 characters." }`. */
  details?: Record<string, unknown>;
  /** Seconds to wait, present on 429. */
  retryAfter?: number;
}

export type ApiEnvelope<T> = { data: T; error?: never } | { data?: never; error: ApiErrorBody };

/** Shape of the `error.details.fields` map the validation layer emits. */
export type FieldErrors = Record<string, string>;

/** Narrows an unknown error body to something the UI can render. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ApiErrorBody>;
  return (
    typeof candidate.code === 'string' &&
    (Object.keys(API_ERROR_STATUS) as string[]).includes(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.requestId === 'string'
  );
}

/**
 * Pulls `{ field: message }` out of an error body.
 *
 * The validation layer emits `details.fields`; anything else in `details` is
 * diagnostic and is deliberately not exposed to form rendering.
 */
export function fieldErrorsOf(body: ApiErrorBody | undefined): FieldErrors {
  const fields = body?.details?.fields;
  if (typeof fields !== 'object' || fields === null) return {};

  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
