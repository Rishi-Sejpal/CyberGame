import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { clearDatabase, teardownDatabase, useTestDatabase } from './helpers/db';
import { buildRequest, sessionFromResponse, readJson, type ApiEnvelope } from './helpers/request';

const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { POST: _logout } = await import('@/app/api/auth/logout/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { POST: logoutAll } = await import('@/app/api/auth/logout-all/route');
const { POST: verifyEmail } = await import('@/app/api/auth/verify-email/route');
const { POST: forgotPassword } = await import('@/app/api/auth/forgot-password/route');
const { POST: resetPassword } = await import('@/app/api/auth/reset-password/route');
const { POST: _resendVerification } = await import('@/app/api/auth/resend-verification/route');
const { POST: changePassword } = await import('@/app/api/auth/change-password/route');
const { GET: sessions } = await import('@/app/api/auth/sessions/route');
const { DELETE: revokeSession } = await import('@/app/api/auth/sessions/[id]/route');
const { GET: devOutbox } = await import('@/app/api/dev/outbox/route');
const { GET: _health } = await import('@/app/api/health/route');

const VALID = {
  username: 'nettra',
  email: 'nettra@cybergrid.test',
  password: 'Grid-Light-99!loop',
  confirmPassword: 'Grid-Light-99!loop',
};

describe('security: authentication', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('rejects registration with SQL injection in username', async () => {
    const res = await register(
      buildRequest('/api/auth/register', {
        body: { ...VALID, username: "admin'--", email: 'x@y.test' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(422);
  });

  it('rejects registration with XSS payload in username', async () => {
    const res = await register(
      buildRequest('/api/auth/register', {
        body: { ...VALID, username: '<script>alert(1)</script>', email: 'x@y.test' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(422);
  });

  it('rejects login with NoSQL injection in identifier', async () => {
    await register(buildRequest('/api/auth/register', { body: VALID }), {
      params: Promise.resolve({}),
    });
    const res = await login(
      buildRequest('/api/auth/login', {
        body: { identifier: { $ne: null }, password: 'x' },
      }),
      { params: Promise.resolve({}) },
    );
    expect([400, 401, 422]).toContain(res.status);
  });

  it('enforces rate limiting on login', async () => {
    await register(buildRequest('/api/auth/register', { body: VALID }), {
      params: Promise.resolve({}),
    });
    let throttled = false;
    for (let i = 0; i < 20; i++) {
      const res = await login(
        buildRequest('/api/auth/login', { body: { identifier: 'nettra', password: 'wrong' } }),
        { params: Promise.resolve({}) },
      );
      if (res.status === 429) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });

  it('returns identical error for unknown user vs wrong password', async () => {
    await register(buildRequest('/api/auth/register', { body: VALID }), {
      params: Promise.resolve({}),
    });
    const wrong = await login(
      buildRequest('/api/auth/login', {
        body: { identifier: 'nettra', password: 'Wrong-Password-77!' },
      }),
      { params: Promise.resolve({}) },
    );
    const unknown = await login(
      buildRequest('/api/auth/login', {
        body: { identifier: 'ghost', password: 'Wrong-Password-77!' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(wrong.status).toBe(unknown.status);
    const w = await readJson<ApiEnvelope<unknown>>(wrong);
    const u = await readJson<ApiEnvelope<unknown>>(unknown);
    expect(w.error?.message).toBe(u.error?.message);
  });
});

describe('security: session management', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('invalidates session on password change', async () => {
    const { session } = await registerAndLogin();
    await changePassword(
      buildRequest('/api/auth/change-password', {
        body: {
          currentPassword: VALID.password,
          password: 'New-Pass-42!',
          confirmPassword: 'New-Pass-42!',
        },
        cookies: { cg_session: session },
      }),
      { params: Promise.resolve({}) },
    );
    const after = await me(
      buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
      { params: Promise.resolve({}) },
    );
    expect(after.status).toBe(401);
  });

  it('invalidates all sessions on logout-all', async () => {
    const { session } = await registerAndLogin();
    await login(
      buildRequest('/api/auth/login', { body: { identifier: 'nettra', password: VALID.password } }),
      { params: Promise.resolve({}) },
    );
    await logoutAll(buildRequest('/api/auth/logout-all', { cookies: { cg_session: session } }), {
      params: Promise.resolve({}),
    });
    const after = await me(
      buildRequest('/api/auth/me', { method: 'GET', cookies: { cg_session: session } }),
      { params: Promise.resolve({}) },
    );
    expect(after.status).toBe(401);
  });

  it('cannot revoke another user session (IDOR)', async () => {
    const victim = await registerAndLogin();
    // Register attacker - register creates a session automatically
    const attackerReg = await register(
      buildRequest('/api/auth/register', {
        body: { ...VALID, username: 'drift', email: 'drift@test' },
      }),
      { params: Promise.resolve({}) },
    );
    const attackerSession = sessionFromResponse(attackerReg)!;
    const list = await sessions(
      buildRequest('/api/auth/sessions', {
        method: 'GET',
        cookies: { cg_session: victim.session },
      }),
      { params: Promise.resolve({}) },
    );
    const victimSessionId = (await readJson<ApiEnvelope<{ sessions: Array<{ id: string }> }>>(list))
      .data!.sessions[0]!.id;
    const revoke = await revokeSession(
      buildRequest(`/api/auth/sessions/${victimSessionId}`, {
        method: 'DELETE',
        cookies: { cg_session: attackerSession },
      }),
      { params: Promise.resolve({ id: victimSessionId }) },
    );
    expect([401, 404]).toContain(revoke.status);
  });
});

describe('security: CSRF protection', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('rejects cross-origin POST', async () => {
    const res = await register(
      buildRequest('/api/auth/register', { body: VALID, origin: 'https://evil.example' }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it('rejects POST with no Origin header', async () => {
    const res = await register(buildRequest('/api/auth/register', { body: VALID, origin: null }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it('rejects mismatched double-submit token', async () => {
    const res = await register(
      buildRequest('/api/auth/register', { body: VALID, csrf: 'invalid' }),
      {
        params: Promise.resolve({}),
      },
    );
    expect(res.status).toBe(403);
  });

  it('allows GET without CSRF token', async () => {
    const res = await me(buildRequest('/api/auth/me', { method: 'GET', csrf: 'none' }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('security: password reset', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('returns same response for known and unknown email', async () => {
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
    const knownData = (await readJson<ApiEnvelope<unknown>>(known)).data;
    const unknownData = (await readJson<ApiEnvelope<unknown>>(unknown)).data;
    expect(knownData).toEqual(unknownData);
  });

  it('reset token is single-use', async () => {
    await registerAndLogin();
    await forgotPassword(
      buildRequest('/api/auth/forgot-password', { body: { email: VALID.email } }),
      { params: Promise.resolve({}) },
    );
    const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
    const mail = await EmailOutboxModel.findOne({ kind: 'password-reset' }).lean();
    const token = new URL(mail!.actionUrl!).searchParams.get('token')!;
    const first = await resetPassword(
      buildRequest('/api/auth/reset-password', {
        body: { token, password: 'New-Pass-42!', confirmPassword: 'New-Pass-42!' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(first.status).toBe(200);
    const replay = await resetPassword(
      buildRequest('/api/auth/reset-password', {
        body: { token, password: 'Another-Pass-88!', confirmPassword: 'Another-Pass-88!' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(replay.status).toBe(401);
  });

  it('verification token cannot be used for password reset', async () => {
    await registerAndLogin();
    const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
    const mail = await EmailOutboxModel.findOne({ kind: 'verification' }).lean();
    const token = new URL(mail!.actionUrl!).searchParams.get('token')!;
    const res = await resetPassword(
      buildRequest('/api/auth/reset-password', {
        body: { token, password: 'Cross-33!', confirmPassword: 'Cross-33!' },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(401);
  });
});

describe('security: email verification', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('verifies email and activates account', async () => {
    await registerAndLogin();
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
  });

  it('rejects replayed verification token', async () => {
    await registerAndLogin();
    const { EmailOutboxModel } = await import('@/server/db/models/email-outbox.model');
    const mail = await EmailOutboxModel.findOne({ kind: 'verification' }).lean();
    const token = new URL(mail!.actionUrl!).searchParams.get('token')!;
    await verifyEmail(buildRequest('/api/auth/verify-email', { body: { token } }), {
      params: Promise.resolve({}),
    });
    const replay = await verifyEmail(buildRequest('/api/auth/verify-email', { body: { token } }), {
      params: Promise.resolve({}),
    });
    expect(replay.status).toBe(401);
  });
});

describe('security: dev endpoints not reachable in production', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });
  afterAll(async () => {
    await teardownDatabase();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('dev outbox requires DEV_MAIL_PREVIEW=true', async () => {
    const res = await devOutbox(buildRequest('/api/dev/outbox', { method: 'GET' }), {
      params: Promise.resolve({}),
    });
    expect([403, 500]).toContain(res.status);
  });
});

// Health endpoint header test requires a running server; skipped in unit tests
// describe('security: headers', () => {
//   it('health endpoint returns correct headers', async () => {
//     const res = await fetch('http://localhost:3000/api/health');
//     expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
//   });
// });

async function registerAndLogin(): Promise<{ session: string; csrf: string; userId: string }> {
  const reg = await register(buildRequest('/api/auth/register', { body: VALID }), {
    params: Promise.resolve({}),
  });
  expect(reg.status).toBe(201);
  const session = sessionFromResponse(reg)!;
  const body = await readJson<ApiEnvelope<{ user: { id: string } }>>(reg);
  return { session, csrf: '', userId: body.data!.user.id };
}
