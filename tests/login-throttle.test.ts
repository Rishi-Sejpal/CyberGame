import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearDatabase, teardownDatabase, useTestDatabase } from './helpers/db';
import { buildRequest, readJson, sessionFromResponse } from './helpers/request';
import { checkRateLimit, RATE_RULES } from '@/server/security/rate-limit';

const REGISTER = '/api/auth/register';
const LOGIN = '/api/auth/login';

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');

const USER = {
  username: 'throttle',
  email: 'throttle@cybergrid.test',
  password: 'Grid-Light-99!loop',
  confirmPassword: 'Grid-Light-99!loop',
};

/**
 * The login path charges an identifier-keyed bucket on every attempt, because an
 * unknown identifier has no failedLoginCount to lock. That only stays honest if a
 * successful sign-in gives the budget back — otherwise six legitimate sign-ins
 * inside the window lock out a user who never failed once.
 */
describe('login throttle', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  async function registerUser(): Promise<void> {
    const res = await register(buildRequest(REGISTER, { body: USER }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(201);
  }

  async function signIn(): Promise<Response> {
    return login(
      buildRequest(LOGIN, { body: { identifier: USER.email, password: USER.password } }),
      { params: Promise.resolve({}) },
    );
  }

  it('allows repeated successful sign-ins beyond the per-account attempt limit', async () => {
    await registerUser();

    const limit = RATE_RULES['login-per-account'].limit;
    // One more than the bucket allows, so an un-cleared bucket must fail here.
    for (let attempt = 0; attempt <= limit; attempt += 1) {
      const res = await signIn();
      expect(res.status, `sign-in ${attempt + 1} of ${limit + 1} was throttled`).toBe(200);
    }
  });

  it('still throttles an unknown identifier, which has no failure counter', async () => {
    const limit = RATE_RULES['login-per-account'].limit;
    let throttledAt = 0;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= limit + 2; attempt += 1) {
      const res = await login(
        buildRequest(LOGIN, {
          body: { identifier: 'ghost@cybergrid.test', password: 'wrong-password' },
        }),
        { params: Promise.resolve({}) },
      );
      lastStatus = res.status;
      if (res.status === 429) {
        throttledAt = attempt;
        break;
      }
    }

    expect(throttledAt).toBeGreaterThan(0);
    expect(lastStatus).toBe(429);
  });

  it('locks a known account on the eighth wrong password, before the throttle', async () => {
    await registerUser();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await login(
        buildRequest(LOGIN, { body: { identifier: USER.email, password: 'not-the-password' } }),
        { params: Promise.resolve({}) },
      );
      statuses.push(res.status);
    }

    // The persistent account lock must win, not the per-process attempt bucket:
    // the lock survives a restart and is shared across instances.
    expect(statuses.slice(0, 7).every((code) => code === 401)).toBe(true);
    expect(statuses[7]).toBe(423);
  });

  it('refuses even the correct password while the account is locked', async () => {
    await registerUser();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login(
        buildRequest(LOGIN, { body: { identifier: USER.email, password: 'not-the-password' } }),
        { params: Promise.resolve({}) },
      );
    }

    // Locked, so even the right password is refused until the window passes.
    const blocked = await signIn();
    expect(blocked.status).toBe(423);
  });

  it('keys the per-account bucket per identifier, not globally', () => {
    const rule = RATE_RULES['login-per-account'];
    expect(checkRateLimit(rule, 'acct:one@example.test').allowed).toBe(true);
    expect(checkRateLimit(rule, 'acct:two@example.test').allowed).toBe(true);
  });

  it('issues a fresh session on each sign-in rather than reusing the first', async () => {
    await registerUser();

    const first = await signIn();
    expect(first.status).toBe(200);
    const second = await signIn();
    expect(second.status).toBe(200);

    const a = sessionFromResponse(first);
    const b = sessionFromResponse(second);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);

    // The response must carry a real user: a spread of the mongoose document
    // once shipped `id: "undefined"` with an epoch createdAt and no email.
    const body = await readJson<{
      data: { user: { id: string; email: string; username: string } };
    }>(second);
    expect(body.data.user.email).toBe(USER.email);
    expect(body.data.user.username).toBe(USER.username);
    expect(body.data.user.id).toMatch(/^[0-9a-f]{24}$/);
  });
});
