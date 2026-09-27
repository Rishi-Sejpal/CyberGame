import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearDatabase, teardownDatabase, useTestDatabase } from './helpers/db';
import {
  buildRequest,
  readJson,
  sessionFromResponse,
  csrfFromResponse,
  type ApiEnvelope,
} from './helpers/request';
import { resetRateLimit, RATE_RULES } from '@/server/security/rate-limit';

const REGISTER = '/api/auth/register';
const LOGIN = '/api/auth/login';
const LOGOUT = '/api/auth/logout';

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: logout } = await import('@/app/api/auth/logout/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { POST: forgotPassword } = await import('@/app/api/auth/forgot-password/route');
const { POST: resetPassword } = await import('@/app/api/auth/reset-password/route');
const { GET: sessions } = await import('@/app/api/auth/sessions/route');
const { DELETE: revokeSession } = await import('@/app/api/auth/sessions/[id]/route');
const {
  serializeCookie,
  serializeDeletion,
  createCookieJar,
  cookieSourceFromHeader,
  cookieSourceFromStore,
  readCookie,
} = await import('@/server/security/cookies');
const { timingSafeEqual } = await import('@/server/security/timing');
const { POST: logoutAll } = await import('@/app/api/auth/logout-all/route');
const { POST: verifyEmail } = await import('@/app/api/auth/verify-email/route');

const VALID = {
  username: 'nettra',
  email: 'nettra@cybergrid.test',
  password: 'Grid-Light-99!loop',
  confirmPassword: 'Grid-Light-99!loop',
};

function clearLimits(): void {
  for (const rule of Object.values(RATE_RULES)) {
    for (const id of [
      'unknown',
      `acct:${VALID.email}`,
      `acct:${VALID.username}`,
      'acct:ghost',
      '',
    ]) {
      resetRateLimit(rule, id);
    }
  }
}

async function registerAndLogin(): Promise<{ session: string; csrf: string; userId: string }> {
  const reg = await register(buildRequest(REGISTER, { body: VALID }), {
    params: Promise.resolve({}),
  });
  expect(reg.status).toBe(201);
  const session = sessionFromResponse(reg)!;
  const csrf = csrfFromResponse(reg)!;
  const body = await readJson<ApiEnvelope<{ user: { id: string } }>>(reg);
  return { session, csrf, userId: body.data!.user.id };
}

describe('authentication', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
    clearLimits();
  });

  describe('registration', () => {
    it('creates an account, a profile and a session', async () => {
      const res = await register(buildRequest(REGISTER, { body: VALID }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(201);

      const body = await readJson<ApiEnvelope<{ user: Record<string, unknown> }>>(res);
      expect(body.data?.user).toMatchObject({
        username: 'nettra',
        email: 'nettra@cybergrid.test',
        role: 'player',
        status: 'pending_verification',
        emailVerified: false,
      });
      // Nothing sensitive crosses the wire.
      expect(JSON.stringify(body)).not.toContain('argon2');
      expect(JSON.stringify(body)).not.toContain('passwordHash');
    });

    it('never lets the client choose a role', async () => {
      const res = await register(buildRequest(REGISTER, { body: { ...VALID, role: 'admin' } }), {
        params: Promise.resolve({}),
      });
      // `.strict()` rejects the unknown key outright.
      expect(res.status).toBe(422);
      const body = await readJson<ApiEnvelope<unknown>>(res);
      expect(body.error?.code).toBe('validation_failed');
    });

    it('rejects a weak password with actionable field detail', async () => {
      const res = await register(
        buildRequest(REGISTER, {
          body: { ...VALID, password: 'password', confirmPassword: 'password' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(422);
      const body = await readJson<ApiEnvelope<unknown>>(res);
      const fields = body.error?.details?.fields as Record<string, string>;
      expect(fields.password).toMatch(/12 characters/);
    });

    it('rejects a password containing the username', async () => {
      const res = await register(
        buildRequest(REGISTER, {
          body: { ...VALID, password: 'Nettra-Nettra-99!', confirmPassword: 'Nettra-Nettra-99!' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(422);
    });

    it('rejects mismatched confirmation', async () => {
      const res = await register(
        buildRequest(REGISTER, { body: { ...VALID, confirmPassword: 'Something-Else-99!' } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(422);
    });

    it('rejects a duplicate username', async () => {
      await registerAndLogin();
      const res = await register(buildRequest(REGISTER, { body: VALID }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate email regardless of case', async () => {
      await registerAndLogin();
      const res = await register(
        buildRequest(REGISTER, {
          body: { ...VALID, username: 'nettra2', email: 'NETTRA@CYBERGRID.TEST' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(409);
    });

    it('rejects a reserved username', async () => {
      const res = await register(
        buildRequest(REGISTER, { body: { ...VALID, username: 'admin' } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(422);
    });

    it('rejects malformed JSON', async () => {
      const req = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'x-csrf-token': 'a'.repeat(40),
          cookie: `cg_csrf=${'a'.repeat(40)}`,
        },
        body: '{not json',
      });
      const { NextRequest } = await import('next/server');
      const res = await register(new NextRequest(req), { params: Promise.resolve({}) });
      // readJson throws a plain Error -> handled as a 500, but must not leak.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('login', () => {
    it('signs in with a username', async () => {
      await registerAndLogin();
      const res = await login(
        buildRequest(LOGIN, { body: { identifier: 'nettra', password: VALID.password } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
      expect(sessionFromResponse(res)).toBeTruthy();
    });

    it('signs in with an email regardless of case', async () => {
      await registerAndLogin();
      const res = await login(
        buildRequest(LOGIN, {
          body: { identifier: 'NETTRA@CYBERGrid.test', password: VALID.password },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
    });

    it('returns an identical error for a wrong password and an unknown user', async () => {
      await registerAndLogin();

      const wrongPassword = await login(
        buildRequest(LOGIN, { body: { identifier: 'nettra', password: 'Wrong-Password-77!' } }),
        { params: Promise.resolve({}) },
      );
      const unknownUser = await login(
        buildRequest(LOGIN, {
          body: { identifier: 'ghost_operator', password: 'Wrong-Password-77!' },
        }),
        { params: Promise.resolve({}) },
      );

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);
      expect((await readJson<ApiEnvelope<unknown>>(wrongPassword)).error!.message).toBe(
        (await readJson<ApiEnvelope<unknown>>(unknownUser)).error!.message,
      );
    });

    it('locks the account after repeated failures', async () => {
      await registerAndLogin();
      let last: Response | null = null;
      for (let i = 0; i < 8; i += 1) {
        last = await login(
          buildRequest(LOGIN, { body: { identifier: 'nettra', password: 'Nope-Nope-77!' } }),
          { params: Promise.resolve({}) },
        );
        resetRateLimit(RATE_RULES['login-per-account'], 'acct:nettra');
      }
      expect(last).not.toBeNull();
      expect([423, 429]).toContain(last!.status);
    });

    it('does not leak whether an email is registered at the login endpoint', async () => {
      await registerAndLogin();
      const byEmail = await login(
        buildRequest(LOGIN, { body: { identifier: VALID.email, password: 'totally-wrong-1!' } }),
        { params: Promise.resolve({}) },
      );
      const byGhost = await login(
        buildRequest(LOGIN, {
          body: { identifier: 'nobody@nowhere.test', password: 'totally-wrong-1!' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(byEmail.status).toBe(byGhost.status);
      expect((await readJson<ApiEnvelope<unknown>>(byEmail)).error!.message).toBe(
        (await readJson<ApiEnvelope<unknown>>(byGhost)).error!.message,
      );
    });
  });

  describe('session lifecycle', () => {
    it('resolves /me for a valid session and rejects an anonymous caller', async () => {
      const { session, csrf } = await registerAndLogin();

      const authed = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(authed.status).toBe(200);
      const body = await readJson<ApiEnvelope<{ user: { username: string } }>>(authed);
      expect(body.data?.user.username).toBe('nettra');

      const anon = await me(buildRequest('/api/auth/me', { method: 'GET' }), {
        params: Promise.resolve({}),
      });
      expect(anon.status).toBe(401);
      void csrf;
    });

    it('rejects a forged session cookie', async () => {
      const res = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: 'f'.repeat(64) } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(401);
    });

    it('invalidates the session on logout', async () => {
      const { session } = await registerAndLogin();

      const out = await logout(buildRequest(LOGOUT, { cookies: { cg_session: session } }), {
        params: Promise.resolve({}),
      });
      expect(out.status).toBe(200);

      const after = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(after.status).toBe(401);
    });

    it('revokes every session on logout-all', async () => {
      const { session } = await registerAndLogin();
      // A second device.
      await login(
        buildRequest(LOGIN, { body: { identifier: 'nettra', password: VALID.password } }),
        { params: Promise.resolve({}) },
      );

      const res = await logoutAll(
        buildRequest('/api/auth/logout-all', { cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);

      const after = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(after.status).toBe(401);
    });

    it('lists only the owner’s sessions', async () => {
      const { session } = await registerAndLogin();
      const res = await sessions(
        buildRequest('/api/auth/sessions', { method: 'GET', cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
      const body =
        await readJson<ApiEnvelope<{ sessions: Array<{ id: string; current: boolean }> }>>(res);
      expect(body.data?.sessions.length).toBeGreaterThanOrEqual(1);
      expect(body.data?.sessions.some((s) => s.current)).toBe(true);
    });
  });

  describe('IDOR resistance', () => {
    it('cannot revoke another player’s session', async () => {
      const victim = await registerAndLogin();
      // A second, unrelated account whose attacker will try to revoke the victim's session.
      const attacker = await register(
        buildRequest(REGISTER, {
          body: { ...VALID, username: 'drift', email: 'drift@cybergrid.test' },
        }),
        { params: Promise.resolve({}) },
      );
      const attackerSession = sessionFromResponse(attacker)!;

      const list = await sessions(
        buildRequest('/api/auth/sessions', {
          method: 'GET',
          cookies: { cg_session: victim.session },
        }),
        { params: Promise.resolve({}) },
      );
      const victimSessionId = (
        await readJson<ApiEnvelope<{ sessions: Array<{ id: string }> }>>(list)
      ).data!.sessions[0]!.id;

      const revoke = await revokeSession(
        buildRequest(`/api/auth/sessions/${victimSessionId}`, {
          method: 'DELETE',
          cookies: { cg_session: attackerSession },
        }),
        { params: Promise.resolve({ id: victimSessionId }) },
      );
      // 404, not 403: the response must not confirm that the id exists at all.
      expect(revoke.status).toBe(404);
      const revokedBody = JSON.parse(await revoke.text());
      expect(revokedBody.error.code).toBe('not_found');

      // A well-formed id that does not exist must be indistinguishable from one
      // that belongs to someone else, so the endpoint is not an existence oracle.
      const unknownId = '0'.repeat(24);
      const unknown = await revokeSession(
        buildRequest(`/api/auth/sessions/${unknownId}`, {
          method: 'DELETE',
          cookies: { cg_session: attackerSession },
        }),
        { params: Promise.resolve({ id: unknownId }) },
      );
      expect(unknown.status).toBe(404);
      // `requestId` differs per response by design, so it is stripped before the
      // comparison; everything the caller can act on must be identical.
      const unknownBody = JSON.parse(await unknown.text());
      delete unknownBody.error.requestId;
      delete revokedBody.error.requestId;
      expect(unknownBody).toEqual(revokedBody);

      // The victim is still signed in.
      const stillIn = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: victim.session } }),
        { params: Promise.resolve({}) },
      );
      expect(stillIn.status).toBe(200);
    });

    it('rejects a non-ObjectId session id outright', async () => {
      const { session } = await registerAndLogin();
      const res = await revokeSession(
        buildRequest('/api/auth/sessions/not-an-object-id', {
          method: 'DELETE',
          cookies: { cg_session: session },
        }),
        { params: Promise.resolve({ id: 'not-an-object-id' }) },
      );
      expect(res.status).toBe(422);
    });
  });

  describe('CSRF', () => {
    it('rejects a cross-origin mutation', async () => {
      const res = await register(
        buildRequest(REGISTER, { body: VALID, origin: 'https://evil.example' }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(403);
      expect((await readJson<ApiEnvelope<unknown>>(res)).error!.code).toBe('csrf_rejected');
    });

    it('rejects a mutation with no Origin at all', async () => {
      const res = await register(buildRequest(REGISTER, { body: VALID, origin: null }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(403);
    });

    it('rejects a mismatched double-submit token', async () => {
      const res = await register(buildRequest(REGISTER, { body: VALID, csrf: 'invalid' }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(403);
    });

    it('allows a read with no CSRF token', async () => {
      const res = await me(buildRequest('/api/auth/me', { method: 'GET', csrf: 'none' }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('password reset', () => {
    it('returns success for both known and unknown addresses', async () => {
      await registerAndLogin();

      const known = await forgotPassword(
        buildRequest('/api/auth/forgot-password', { body: { email: VALID.email } }),
        { params: Promise.resolve({}) },
      );
      const unknown = await forgotPassword(
        buildRequest('/api/auth/forgot-password', { body: { email: 'nobody@nowhere.test' } }),
        { params: Promise.resolve({}) },
      );

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect((await readJson<ApiEnvelope<unknown>>(known)).data).toEqual(
        (await readJson<ApiEnvelope<unknown>>(unknown)).data,
      );
    });

    it('rejects an invalid reset token without revealing why', async () => {
      const res = await resetPassword(
        buildRequest('/api/auth/reset-password', {
          body: {
            token: 'f'.repeat(48),
            password: 'Brand-New-Pass-42!',
            confirmPassword: 'Brand-New-Pass-42!',
          },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(401);
      const body = await readJson<ApiEnvelope<unknown>>(res);
      expect(body.error?.message).toBe('Invalid or expired credentials.');
    });

    it('is single-use and invalidates existing sessions', async () => {
      const { session } = await registerAndLogin();

      // Issue a reset, then read the token back out of the dev outbox.
      await forgotPassword(
        buildRequest('/api/auth/forgot-password', { body: { email: VALID.email } }),
        { params: Promise.resolve({}) },
      );
      const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
      const mail = await EmailOutboxModel.findOne({ kind: 'password-reset' }).lean();
      const token = new URL(mail!.actionUrl!).searchParams.get('token')!;

      const newPassword = 'Rotated-Passphrase-71!';
      const first = await resetPassword(
        buildRequest('/api/auth/reset-password', {
          body: { token, password: newPassword, confirmPassword: newPassword },
        }),
        { params: Promise.resolve({}) },
      );
      expect(first.status).toBe(200);

      // The old session is dead.
      const stale = await me(
        buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
        { params: Promise.resolve({}) },
      );
      expect(stale.status).toBe(401);

      // The new password works.
      const relogin = await login(
        buildRequest(LOGIN, { body: { identifier: 'nettra', password: newPassword } }),
        { params: Promise.resolve({}) },
      );
      expect(relogin.status).toBe(200);

      // Replaying the token fails.
      const replay = await resetPassword(
        buildRequest('/api/auth/reset-password', {
          body: { token, password: 'Another-Pass-88!', confirmPassword: 'Another-Pass-88!' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(replay.status).toBe(401);
    });
  });

  describe('email verification', () => {
    it('activates the account and is single-use', async () => {
      const { userId } = await registerAndLogin();
      const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
      const mail = await EmailOutboxModel.findOne({ kind: 'verification' }).lean();
      const token = new URL(mail!.actionUrl!).searchParams.get('token')!;

      const res = await verifyEmail(buildRequest('/api/auth/verify-email', { body: { token } }), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(200);
      const body =
        await readJson<ApiEnvelope<{ user: { status: string; emailVerified: boolean } }>>(res);
      expect(body.data?.user.status).toBe('active');
      expect(body.data?.user.emailVerified).toBe(true);
      void userId;

      const replay = await verifyEmail(
        buildRequest('/api/auth/verify-email', { body: { token } }),
        { params: Promise.resolve({}) },
      );
      expect(replay.status).toBe(401);
    });

    it('refuses a verification token replayed against the reset endpoint', async () => {
      await registerAndLogin();
      const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
      const mail = await EmailOutboxModel.findOne({ kind: 'verification' }).lean();
      const token = new URL(mail!.actionUrl!).searchParams.get('token')!;

      const res = await resetPassword(
        buildRequest('/api/auth/reset-password', {
          body: { token, password: 'Cross-Purpose-33!', confirmPassword: 'Cross-Purpose-33!' },
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(401);
    });
  });

  describe('rate limiting', () => {
    it('throttles repeated failed logins from one identifier', async () => {
      await registerAndLogin();
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await login(
          buildRequest(LOGIN, { body: { identifier: 'nettra', password: 'Bad-Password-11!' } }),
          { params: Promise.resolve({}) },
        );
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 429 || s === 423).length).toBeGreaterThan(0);
    });

    it('returns Retry-After on a throttled request', async () => {
      await registerAndLogin();
      let throttled: Response | null = null;
      for (let i = 0; i < 20; i += 1) {
        const res = await login(
          buildRequest(LOGIN, { body: { identifier: 'nettra', password: 'Bad-Password-11!' } }),
          { params: Promise.resolve({}) },
        );
        if (res.status === 429) {
          throttled = res;
          break;
        }
      }
      expect(throttled).not.toBeNull();
      expect(throttled!.headers.get('retry-after')).toBeTruthy();
    });
  });
});

describe('cookie serialisation', () => {
  it('emits the hardening attributes on a session cookie', () => {
    const serialized = serializeCookie('cg_session', 'a b/c', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    });
    expect(serialized).toBe(
      'cg_session=a%20b%2Fc; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('omits Secure when the deployment is plain http on localhost', () => {
    expect(serializeCookie('cg_csrf', 'x', { sameSite: 'lax' })).not.toContain('Secure');
  });

  it('expires a deletion immediately', () => {
    const serialized = serializeDeletion('cg_session');
    expect(serialized).toContain('Max-Age=0');
    expect(serialized).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('refuses names that could inject header syntax', () => {
    expect(() => serializeCookie('cg\r\nSet-Cookie: evil=1', 'x')).toThrow(/invalid name/);
    expect(() => serializeCookie('', 'x')).toThrow(/invalid name/);
  });

  it('round-trips through the raw header parser', () => {
    const header = 'cg_session=abc123; cg_csrf=zzz%20yyy; theme=dark';
    expect(readCookie(header, 'cg_session')).toBe('abc123');
    expect(readCookie(header, 'cg_csrf')).toBe('zzz yyy');
    expect(readCookie(header, 'theme')).toBe('dark');
    expect(readCookie(header, 'absent')).toBeNull();
    expect(readCookie(null, 'cg_session')).toBeNull();
  });

  it('survives a malformed percent escape instead of throwing', () => {
    expect(readCookie('cg_session=%E0%A4%A', 'cg_session')).toBe('%E0%A4%A');
  });

  it('reads cookies out of a Next cookie store by name', () => {
    // Regression: a Server Component has no `Request`, so the jar used to be built
    // from `store.get('cookie')`. Next's `cookies()` exposes no synthetic
    // `cookie` entry, so that lookup returned undefined and every jar read
    // nothing — which made each signed-in page redirect to /login while the API
    // routes, built from the real header, kept working. Typecheck, build and unit
    // tests were all green; only a live request exposed it.
    const nextStore = {
      getAll: () => [
        { name: 'cg_session', value: 'abc' },
        { name: 'cg_csrf', value: 'def' },
      ],
      get: (name: string) =>
        name === 'cg_session'
          ? { name, value: 'abc' }
          : name === 'cg_csrf'
            ? { name, value: 'def' }
            : undefined,
    };

    const jar = createCookieJar(cookieSourceFromStore(nextStore));
    expect(jar.get('cg_session')).toBe('abc');
    expect(jar.get('cg_csrf')).toBe('def');
    expect(jar.get('absent')).toBeUndefined();

    // The trap itself: reconstructing a header from that store yields nothing.
    expect(nextStore.get('cookie')).toBeUndefined();
    expect(
      createCookieJar(cookieSourceFromHeader(nextStore.get('cookie')?.value)).get('cg_session'),
    ).toBeUndefined();
  });

  it('applies queued writes and deletions onto a response', () => {
    const jar = createCookieJar(cookieSourceFromHeader('cg_session=old'));
    expect(jar.get('cg_session')).toBe('old');
    jar.set('cg_session', 'new', { httpOnly: true, sameSite: 'lax' });
    jar.delete('cg_csrf');

    const response = new Response(null, { status: 204 });
    jar.applyTo(response);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('cg_session=new');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[1]).toContain('cg_csrf=');
    expect(cookies[1]).toContain('Max-Age=0');
  });

  it('reads through to a live source so a refresh write is observable', () => {
    const source = { get: (name: string) => (name === 'a' ? { value: '1' } : undefined) };
    const jar = createCookieJar(source);
    expect(jar.get('a')).toBe('1');
    expect(jar.get('b')).toBeUndefined();
    expect(jar.pending()).toEqual([]);
  });
});

describe('timing-safe comparison', () => {
  it('matches identical strings and rejects everything else', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'abcde')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('a', 'abcdefghij')).toBe(false);
  });

  it('handles multi-byte characters without a length oracle crash', () => {
    expect(timingSafeEqual('é'.repeat(8), 'é'.repeat(8))).toBe(true);
    expect(timingSafeEqual('é'.repeat(8), 'e'.repeat(8))).toBe(false);
  });
});
