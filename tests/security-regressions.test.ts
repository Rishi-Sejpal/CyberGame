import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearDatabase, teardownDatabase, useTestDatabase } from './helpers/db';
import { buildRequest } from './helpers/request';
import { updateProfileSchema } from '@/server/validation/schemas';
import { VerificationTokenModel } from '@/server/db/models/verification-token.model';
import { issueVerificationToken } from '@/server/auth/service';
import { hashToken } from '@/server/security/crypto';

const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: register } = await import('@/app/api/auth/register/route');

/**
 * Regressions from the manual security review. Each block below corresponds to a
 * finding that was fixed, and each test fails if the fix is undone.
 */
describe('profile preference keys cannot escape the settings object', () => {
  /**
   * `settings` is a Mongoose `Mixed` field written with dotted `$set` paths, so
   * the key is the only thing standing between user input and the query
   * operator grammar. `settings.$where` used to reach MongoDB, which rejected it
   * with "dollar ($) prefixed field is not valid for storage" and surfaced as an
   * unhandled 500.
   */
  it('rejects keys that would be read as a query operator', () => {
    const rejected = ['$where', '$set', 'a.$b', '$', 'x$'];
    for (const key of rejected) {
      const result = updateProfileSchema.safeParse({ settings: { [key]: true } });
      expect(result.success, `key "${key}" was accepted`).toBe(false);
    }
  });

  it('rejects keys that would be read as a nested path', () => {
    for (const key of ['a.b', 'reduced.motion', '..', 'a.']) {
      const result = updateProfileSchema.safeParse({ settings: { [key]: 'x' } });
      expect(result.success, `key "${key}" was accepted`).toBe(false);
    }
  });

  it('never lets a prototype-polluting key survive into the parsed settings', () => {
    // `__proto__` is the only key that can actually mutate a prototype. Zod
    // validates keys with the same pattern, so it fails the pattern too — but
    // because assigning that name to the output object would set the prototype
    // rather than create a key, the parse reports success and drops the entry
    // instead. Either outcome is safe; what must never happen is the key
    // reaching the `$set` loop. Assert the security property, not the mechanism.
    const parsed = updateProfileSchema.safeParse({ settings: JSON.parse('{"__proto__":"x"}') });
    const result = parsed.success ? parsed.data.settings : undefined;
    expect(Object.getOwnPropertyNames(result ?? {})).not.toContain('__proto__');
  });

  it('rejects keys that do not look like plain identifiers', () => {
    for (const key of ['_private', '1leading', 'has-dash', 'has space', 'ünïcode']) {
      const result = updateProfileSchema.safeParse({ settings: { [key]: 'x' } });
      expect(result.success, `key "${key}" was accepted`).toBe(false);
    }
  });

  it('still accepts ordinary camelCase preferences', () => {
    const parsed = updateProfileSchema.parse({
      settings: { reducedMotion: true, textSize: 1.25, lastScene: 'neon-district' },
    });
    expect(parsed.settings).toEqual({
      reducedMotion: true,
      textSize: 1.25,
      lastScene: 'neon-district',
    });
  });

  it('keeps the existing key-count ceiling', () => {
    const many: Record<string, boolean> = {};
    for (let i = 0; i < 26; i += 1) many[`pref${i}`] = true;
    expect(updateProfileSchema.safeParse({ settings: many }).success).toBe(false);
  });
});

describe('verification tokens carry no unenforced code material', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  /**
   * A 6-digit code was generated, hashed and stored on every verification token
   * but never returned, emailed or compared. `attemptsRemaining`/`maxAttempts`
   * likewise implied a brute-force counter that did not exist. The fields only
   * looked like protection, so they were removed rather than left to imply a
   * guarantee the code did not make.
   */
  it('stores only the link token, with no code or attempt counter', async () => {
    const userId = new (await import('mongoose')).Types.ObjectId().toString();

    const token = await issueVerificationToken(userId, '198.51.100.4');
    const stored = await VerificationTokenModel.findOne({ tokenHash: hashToken(token) }).lean();

    expect(stored).not.toBeNull();
    expect((stored as unknown as Record<string, unknown>).codeHash).toBeUndefined();
    expect((stored as unknown as Record<string, unknown>).attemptsRemaining).toBeUndefined();
    expect((stored as unknown as Record<string, unknown>).maxAttempts).toBeUndefined();
    expect(stored!.purpose).toBe('email_verification');
    expect(stored!.consumedAt).toBeNull();
  });

  it('returns a high-entropy token, not a guessable code', async () => {
    const userId = new (await import('mongoose')).Types.ObjectId().toString();
    const token = await issueVerificationToken(userId, null);

    // 32 CSPRNG bytes, base64url. A 6-digit code would be 6 characters.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).not.toMatch(/^\d{6}$/);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('rate limiting runs before the CSRF check', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });

  afterAll(async () => {
    // The CSRF-flood test deliberately queues many `auditDetached` writes, which
    // are fire-and-forget by design. Let them land before the client closes, so
    // the run does not end in "client was closed" noise.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await teardownDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  /**
   * `withApi` used to verify CSRF first, and a CSRF rejection writes an audit
   * document. An unauthenticated client could therefore write one audit row per
   * request, forever, simply by omitting the token — an audit-log-filling denial
   * of service that the rate limit could not reach, because it ran afterwards.
   */
  it('throttles a client that only ever fails CSRF', async () => {
    const statuses: number[] = [];

    // No CSRF cookie and no `x-csrf-token`: every one of these is a rejection.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await login(
        buildRequest('/api/auth/login', { csrf: 'none', body: { identifier: 'a@b.test' } }),
        { params: Promise.resolve({}) },
      );
      statuses.push(res.status);
      if (res.status === 429) break;
    }

    expect(statuses[0]).toBe(403);
    expect(statuses).toContain(429);
    expect(statuses.length).toBeLessThan(20);
  });

  it('still answers a well-formed request with a CSRF rejection, not a throttle', async () => {
    const res = await register(
      buildRequest('/api/auth/register', {
        csrf: 'invalid',
        body: {
          username: 'regress',
          email: 'regress@cybergrid.test',
          password: 'Grid-Light-99!loop',
          confirmPassword: 'Grid-Light-99!loop',
        },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });
});
