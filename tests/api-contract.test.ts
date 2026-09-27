import { describe, expect, it } from 'vitest';
import {
  API_ERROR_STATUS,
  fieldErrorsOf,
  isApiErrorBody,
  type ApiErrorBody,
} from '@/shared/api-error';

/**
 * Wire-contract invariants.
 *
 * The browser and the API share these types, so a change to the envelope is
 * visible on both sides at compile time. What types cannot catch is the shape
 * *discipline*: a hand-written body that claims a code the server never sends, a
 * `details` object leaking internal text into a form, or two codes collapsing
 * onto one status in a way that breaks a client branch. Those are asserted here.
 */
describe('API error contract', () => {
  it('maps every code to a status', () => {
    for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
      expect(Number.isInteger(status)).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('keeps the codes a client branches on distinguishable', () => {
    // `csrf_rejected` and `forbidden` both being 403 is intentional, but they
    // must remain separate codes or the client cannot tell "reload the page" from
    // "you may not do that".
    expect(API_ERROR_STATUS.csrf_rejected).toBe(API_ERROR_STATUS.forbidden);
    expect('csrf_rejected').not.toBe('forbidden');
  });

  it('reports a throttle and a lockout as distinct, retryable-in-time states', () => {
    expect(API_ERROR_STATUS.too_many_requests).toBe(429);
    expect(API_ERROR_STATUS.locked).toBe(423);
  });

  it('accepts a well-formed body', () => {
    const body: ApiErrorBody = {
      code: 'validation_failed',
      message: 'Check the highlighted fields.',
      requestId: 'req_abc123',
      details: { fields: { password: 'Too short.' } },
    };
    expect(isApiErrorBody(body)).toBe(true);
  });

  it('rejects a body that claims an unknown code', () => {
    // This is what keeps a proxy's HTML or a stray `{ error: "..." }` from being
    // trusted as a structured failure.
    for (const body of [
      { code: 'teapot', message: 'x', requestId: 'r' },
      { code: 'bad_request', message: 'x' },
      { code: 'bad_request', requestId: 'r' },
      { message: 'x', requestId: 'r' },
      null,
      'string',
      42,
      [],
    ]) {
      expect(isApiErrorBody(body)).toBe(false);
    }
  });

  it('exposes only the field map, never the rest of details', () => {
    // `details` is where diagnostic context lives. A form must render
    // `details.fields` and nothing else, or a stack trace or driver message
    // added for logs ends up on screen.
    const body: ApiErrorBody = {
      code: 'validation_failed',
      message: 'Check the highlighted fields.',
      requestId: 'req_abc123',
      details: {
        fields: { email: 'Enter a valid email address.', count: 7 },
        stack: 'Error: at Object.<anonymous> (/srv/app/route.ts:12)',
        internal: 'mongo: duplicate key',
      },
    };
    expect(fieldErrorsOf(body)).toEqual({ email: 'Enter a valid email address.' });
    expect(JSON.stringify(fieldErrorsOf(body))).not.toContain('stack');
    expect(JSON.stringify(fieldErrorsOf(body))).not.toContain('duplicate key');
  });

  it('returns an empty map when details is missing or malformed', () => {
    const base: ApiErrorBody = { code: 'bad_request', message: 'x', requestId: 'r' };
    expect(fieldErrorsOf(base)).toEqual({});
    expect(fieldErrorsOf({ ...base, details: {} })).toEqual({});
    expect(fieldErrorsOf({ ...base, details: { fields: 'nope' } })).toEqual({});
    expect(fieldErrorsOf({ ...base, details: { fields: null } })).toEqual({});
    expect(fieldErrorsOf(undefined)).toEqual({});
  });
});
