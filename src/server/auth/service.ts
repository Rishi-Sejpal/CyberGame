import 'server-only';

import { connectDb } from '@/server/db/connect';
import { UserModel, type UserDoc } from '@/server/db/models/user.model';
import { ProfileModel } from '@/server/db/models/profile.model';
import { SessionModel } from '@/server/db/models/session.model';
import { VerificationTokenModel } from '@/server/db/models/verification-token.model';
import {
  emailLookupHash,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '@/server/security/password';
import { generateSecret, hashToken, generateNumericCode } from '@/server/security/crypto';
import {
  createSession,
  destroyCurrentSession,
  revokeAllSessions,
  sessionCookieName,
} from '@/server/security/session';
import type { CookieJar } from '@/server/security/cookies';
import { audit, auditDetached } from '@/server/security/audit';
import { AppError, conflict, genericAuthFailure, tooManyRequests } from '@/server/http/errors';
import { RATE_RULES, checkRateLimit, resetRateLimit } from '@/server/security/rate-limit';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendSecurityAlertEmail,
} from '@/server/email/templates';
import { maskEmail } from '@/server/email/service';
import { checkPasswordPolicy, passwordPolicyMessage } from '@/shared/password-policy';
import { toIso, type AccountView } from '@/shared/account';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@/server/validation/schemas';

/**
 * Authentication service.
 *
 * Uniformity is the design constraint. `login`, `forgotPassword` and
 * `verifyEmail` are each written so that an attacker learns nothing from the
 * response, the status code, or the body about whether an account exists:
 *
 *  - Unknown user and wrong password both cost one Argon2id verification. A
 *    "fast path" for unknown users would be an enumeration oracle, so the dummy
 *    hash below is verified against as well.
 *  - All credential failures return the same `AppError` with the same message.
 *  - `forgotPassword` always returns success and always performs comparable
 *    work, whether or not the address exists.
 */

const VERIFICATION_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 60 * 60_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILED_LOGINS = 8;
const LOCK_DURATION_MS = 15 * 60_000;

/**
 * A real Argon2id hash of a random secret. Verifying against it burns the same
 * CPU as a genuine check, so a missing account is not distinguishable by timing.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`\u0000dummy-${generateSecret(24)}`);
  return dummyHashPromise;
}

const PUBLIC_USER_FIELDS = {
  id: 1,
  username: 1,
  displayName: 1,
  email: 1,
  role: 1,
  status: 1,
  emailVerified: 1,
  createdAt: 1,
  lastLoginAt: 1,
} as const;

/**
 * The wire projection of a user row.
 *
 * `AccountView` lives in `src/shared/account.ts` so the browser imports the same
 * type this function returns; a field cannot be added on one side only. Dates
 * become ISO-8601 strings here, at the boundary, so no consumer has to guess
 * whether it received a `Date` or a string.
 */
export type PublicUser = AccountView;

export function toPublicUser(user: Partial<UserDoc> & { _id: unknown }): PublicUser {
  // Mongoose keeps schema fields in an internal `_doc`, so `{ ...doc }` yields an
  // object with none of them — TypeScript cannot catch that, and the result is a
  // silently wrong response (`id: "undefined"`, epoch `createdAt`) rather than an
  // error. Fail loudly instead.
  if (
    !user._id ||
    typeof user.username !== 'string' ||
    typeof user.displayName !== 'string' ||
    typeof user.email !== 'string'
  ) {
    throw new Error(
      'toPublicUser received an unpopulated document — pass the document or its toObject(), not a spread of it',
    );
  }

  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role ?? 'player',
    status: user.status ?? 'pending_verification',
    emailVerified: Boolean(user.emailVerified),
    createdAt: toIso(user.createdAt as Date) ?? new Date(0).toISOString(),
    lastLoginAt: toIso(user.lastLoginAt as Date | null),
  };
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export async function registerUser(
  input: RegisterInput,
  ctx: { ip: string | null; userAgent: string | null; deviceLabel: string },
  jar: CookieJar,
): Promise<PublicUser> {
  await connectDb();

  const policy = checkPasswordPolicy(input.password, {
    username: input.username,
    email: input.email,
  });
  if (!policy.ok) {
    // Field-level detail is safe here: the caller is registering a *new*
    // account and learns nothing about existing ones.
    throw new AppError('validation_failed', 'Choose a stronger password.', {
      details: { fields: { password: passwordPolicyMessage(policy.issues) } },
    });
  }

  const usernameLower = input.username.toLowerCase();
  const emailHash = emailLookupHash(input.email);

  const [usernameTaken, emailTaken] = await Promise.all([
    UserModel.exists({ usernameLower }),
    UserModel.exists({ emailLookupHash: emailHash }),
  ]);

  if (usernameTaken || emailTaken) {
    await audit({
      event: 'auth.register.duplicate',
      severity: 'warning',
      outcome: 'failure',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { username: usernameLower, email: maskEmail(input.email) },
    });
    throw conflict('That username or email is already registered.');
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const user = await UserModel.create({
    username: input.username,
    usernameLower,
    displayName: input.username,
    email: input.email,
    emailLookupHash: emailHash,
    passwordHash,
    role: 'player', // never taken from the request
    status: 'pending_verification',
    emailVerified: false,
    emailVerifiedAt: null,
    passwordChangedAt: now,
    sessionEpoch: 1,
  });

  await ProfileModel.create({
    userId: String(user._id),
    handle: input.username,
    avatarId: 'avatar-recruit',
    xp: 0,
    level: 1,
    xpIntoLevel: 0,
    xpForNextLevel: 500,
    tier: 'beginner',
    streakDays: 0,
    longestStreakDays: 0,
    unlockedModules: ['networking'],
    unlockedLevels: ['networking.l1'],
  });

  const verificationToken = await issueVerificationToken(String(user._id), ctx.ip);
  await sendVerificationEmail({
    to: input.email,
    username: input.username,
    token: verificationToken,
    userId: String(user._id),
  });

  await audit({
    event: 'auth.register',
    severity: 'notice',
    userId: String(user._id),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { username: usernameLower, email: maskEmail(input.email) },
  });

  // Pre-verify accounts (when auto-verification is disabled) still get a usable
  // session, but with `pending_verification` status so gated actions can check it.
  await createSession(
    {
      userId: String(user._id),
      sessionEpoch: user.sessionEpoch,
      label: ctx.deviceLabel,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    jar,
  );

  return toPublicUser(user.toObject());
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginUser(
  input: LoginInput,
  ctx: { ip: string | null; userAgent: string | null; deviceLabel: string },
  jar: CookieJar,
): Promise<PublicUser> {
  await connectDb();

  // Coarse throttle keyed on the identifier alone, charged on every attempt
  // whether or not the account exists — that is deliberate, since an unknown
  // identifier has no failedLoginCount to lock and would otherwise be unlimited.
  // The IP dimension is enforced separately by the route-level `auth.login`
  // rule in `withApi`, which is keyed per client. Both buckets are cleared once
  // the credentials check out, so an honest user is never rate limited.
  const identifier = input.identifier.toLowerCase();
  const perAccount = checkRateLimit(RATE_RULES['login-per-account'], `acct:${identifier}`);
  if (!perAccount.allowed) {
    await audit({
      event: 'auth.rate_limited',
      severity: 'warning',
      outcome: 'blocked',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { rule: 'auth.login.account', retryAfter: perAccount.retryAfter },
    });
    throw tooManyRequests(perAccount.retryAfter);
  }

  const user = await findUserByIdentifier(input.identifier);
  const passwordHash = user?.passwordHash ?? (await dummyHash());
  const valid = await verifyPassword(passwordHash, input.password);

  if (!user || !valid) {
    if (user) {
      const updated = await registerFailedLogin(user);
      if (updated.locked) {
        await audit({
          event: 'auth.login.locked',
          severity: 'warning',
          outcome: 'blocked',
          userId: String(user._id),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { username: user.username, failed: updated.failedCount },
        });
        throw new AppError('locked', 'Too many failed attempts. Try again in 15 minutes.', {
          headers: { 'Retry-After': String(Math.ceil(LOCK_DURATION_MS / 1000)) },
        });
      }
    }
    await audit({
      event: 'auth.login.failure',
      severity: 'warning',
      outcome: 'failure',
      userId: user ? String(user._id) : null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { identifier: maskIdentifier(identifier), known: Boolean(user) },
    });
    // Identical error for "no such user" and "wrong password".
    throw genericAuthFailure();
  }

  if (user.status === 'banned') {
    await audit({
      event: 'auth.login.failure',
      severity: 'warning',
      outcome: 'blocked',
      userId: String(user._id),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'banned' },
    });
    throw genericAuthFailure();
  }

  if (user.status === 'suspended') {
    throw new AppError(
      'forbidden',
      'This account is suspended. Contact support if you believe this is a mistake.',
    );
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await audit({
      event: 'auth.login.locked',
      severity: 'warning',
      outcome: 'blocked',
      userId: String(user._id),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { until: user.lockedUntil.toISOString() },
    });
    throw new AppError('locked', 'Too many failed attempts. Try again in 15 minutes.', {
      headers: {
        'Retry-After': String(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)),
      },
    });
  }

  // Opportunistic rehash: raise cost for existing users without a forced reset.
  if (needsRehash(user.passwordHash)) {
    const upgraded = await hashPassword(input.password);
    await UserModel.updateOne(
      { _id: user._id, passwordHash: user.passwordHash },
      { $set: { passwordHash: upgraded } },
    );
  }

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ip,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        lockedUntil: null,
      },
    },
  );

  // The attempt was legitimate, so give the identifier its budget back. Without
  // this, six successful sign-ins inside the 15 minute window would lock out
  // someone who never failed once.
  resetRateLimit(RATE_RULES['login-per-account'], `acct:${identifier}`);

  if (user.status === 'pending_verification') {
    await sendVerificationEmail({
      to: user.email,
      username: user.username,
      token: await issueVerificationToken(String(user._id), ctx.ip),
      userId: String(user._id),
    });
  }

  await createSession(
    {
      userId: String(user._id),
      sessionEpoch: user.sessionEpoch,
      label: ctx.deviceLabel,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    jar,
  );

  await audit({
    event: 'auth.login.success',
    userId: String(user._id),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { username: user.username, rehash: needsRehash(user.passwordHash) },
  });

  // Assign rather than spread: `user` is a hydrated mongoose document, and
  // spreading one copies none of its schema fields.
  user.lastLoginAt = new Date();
  return toPublicUser(user);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logoutUser(
  ctx: { ip: string | null; userAgent: string | null; userId?: string },
  jar: CookieJar,
): Promise<void> {
  await destroyCurrentSession(jar, jar.get(sessionCookieName()));
  auditDetached({
    event: 'auth.logout',
    userId: ctx.userId ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

export async function logoutEverywhere(
  userId: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<number> {
  const revoked = await revokeAllSessions(userId, 'logout-all', { bumpEpoch: true });
  await audit({
    event: 'auth.logout_all',
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { revoked },
  });
  return revoked;
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function issueVerificationToken(userId: string, ip: string | null): Promise<string> {
  const token = generateSecret(32);
  const code = generateNumericCode(6);
  await VerificationTokenModel.updateMany(
    { userId, purpose: 'email_verification', consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  await VerificationTokenModel.create({
    userId,
    purpose: 'email_verification',
    tokenHash: hashToken(token),
    codeHash: hashToken(code),
    attemptsRemaining: 5,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    requestIp: ip,
  });
  return token;
}

export async function resendVerification(
  userId: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<void> {
  const user = await UserModel.findById(userId);
  if (!user || user.emailVerified) return;
  const token = await issueVerificationToken(userId, ctx.ip);
  await sendVerificationEmail({ to: user.email, username: user.username, token, userId });
  await audit({
    event: 'auth.email_verification_sent',
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { email: maskEmail(user.email) },
  });
}

export async function verifyEmailToken(
  rawToken: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<PublicUser> {
  await connectDb();

  const record = await VerificationTokenModel.findOne({
    tokenHash: hashToken(rawToken),
    purpose: 'email_verification',
  });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    await audit({
      event: 'auth.password_reset_invalid_token',
      severity: 'critical',
      outcome: 'failure',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { flow: 'email_verification' },
    });
    throw genericAuthFailure();
  }

  // Single-use: the update filter includes `consumedAt: null` so two concurrent
  // verifications cannot both succeed.
  const consumed = await VerificationTokenModel.updateOne(
    { _id: record._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (consumed.modifiedCount !== 1) throw genericAuthFailure();

  const user = await UserModel.findByIdAndUpdate(
    record.userId,
    {
      $set: { emailVerified: true, emailVerifiedAt: new Date(), status: 'active' },
    },
    { returnDocument: 'after', projection: PUBLIC_USER_FIELDS },
  ).lean();

  if (!user) throw genericAuthFailure();

  await sendWelcomeEmail({ to: user.email, username: user.username, userId: String(user._id) });

  await audit({
    event: 'auth.email_verified',
    severity: 'notice',
    userId: String(user._id),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return toPublicUser(user as unknown as UserDoc);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(
  email: string,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await connectDb();

  const user = await UserModel.findOne({ emailLookupHash: emailLookupHash(email) });

  // Always perform a comparable amount of work so the response time does not
  // reveal whether the address is registered.
  if (!user) {
    await dummyHash();
    await audit({
      event: 'auth.password_reset_requested',
      severity: 'info',
      outcome: 'success',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { email: maskEmail(email), known: false },
    });
    return;
  }

  const token = generateSecret(32);
  await VerificationTokenModel.updateMany(
    { userId: String(user._id), purpose: 'password_reset', consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  await VerificationTokenModel.create({
    userId: String(user._id),
    purpose: 'password_reset',
    tokenHash: hashToken(token),
    codeHash: null,
    attemptsRemaining: 5,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
    requestIp: ctx.ip,
  });

  await sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    token,
    userId: String(user._id),
  });

  await audit({
    event: 'auth.password_reset_requested',
    userId: String(user._id),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { email: maskEmail(user.email) },
  });
}

export async function resetPassword(
  input: ResetPasswordInput,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<void> {
  await connectDb();

  const record = await VerificationTokenModel.findOne({
    tokenHash: hashToken(input.token),
    purpose: 'password_reset',
  });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    await audit({
      event: 'auth.password_reset_invalid_token',
      severity: 'critical',
      outcome: 'failure',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw genericAuthFailure();
  }

  const user = await UserModel.findById(record.userId);
  if (!user) throw genericAuthFailure();

  const policy = checkPasswordPolicy(input.password, {
    username: user.username,
    email: user.email,
  });
  if (!policy.ok) {
    throw new AppError('validation_failed', 'Choose a stronger password.', {
      details: { fields: { password: passwordPolicyMessage(policy.issues) } },
    });
  }

  const consumed = await VerificationTokenModel.updateOne(
    { _id: record._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (consumed.modifiedCount !== 1) throw genericAuthFailure();

  const passwordHash = await hashPassword(input.password);

  // `sessionEpoch` bump is the critical line: it invalidates every existing
  // session everywhere, which is what a password reset is *for*.
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        sessionEpoch: user.sessionEpoch + 1,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        lockedUntil: null,
      },
    },
  );

  await SessionModel.updateMany(
    { userId: String(user._id), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password-reset' } },
  );

  await sendSecurityAlertEmail({
    to: user.email,
    username: user.username,
    userId: String(user._id),
    detail: 'your password was reset and all active sessions were signed out.',
  });

  await audit({
    event: 'auth.password_reset_completed',
    severity: 'notice',
    userId: String(user._id),
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  ctx: { ip: string | null; userAgent: string | null; sessionId: string },
): Promise<void> {
  await connectDb();

  const user = await UserModel.findById(userId);
  if (!user) throw genericAuthFailure();

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await audit({
      event: 'auth.password_change',
      severity: 'warning',
      outcome: 'failure',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw new AppError('validation_failed', 'Your current password is incorrect.', {
      details: { fields: { currentPassword: 'Incorrect password.' } },
    });
  }

  const policy = checkPasswordPolicy(input.password, {
    username: user.username,
    email: user.email,
  });
  if (!policy.ok) {
    throw new AppError('validation_failed', 'Choose a stronger password.', {
      details: { fields: { password: passwordPolicyMessage(policy.issues) } },
    });
  }

  const passwordHash = await hashPassword(input.password);

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        sessionEpoch: user.sessionEpoch + 1,
        failedLoginCount: 0,
        failedLoginWindowStart: null,
        lockedUntil: null,
      },
    },
  );

  // Keep the current session alive; drop every other one.
  await revokeAllSessions(userId, 'password-change', {
    exceptSessionId: ctx.sessionId,
    bumpEpoch: false,
  });

  await audit({
    event: 'auth.password_change',
    severity: 'notice',
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findUserByIdentifier(identifier: string): Promise<UserDoc | null> {
  const value = identifier.trim();
  const looksLikeEmail = value.includes('@');
  const query = looksLikeEmail
    ? { emailLookupHash: emailLookupHash(value) }
    : { usernameLower: value.toLowerCase() };
  return (await UserModel.findOne(query)) as UserDoc | null;
}

async function registerFailedLogin(
  user: UserDoc,
): Promise<{ failedCount: number; locked: boolean }> {
  const now = Date.now();
  const windowStart = user.failedLoginWindowStart?.getTime() ?? 0;
  const withinWindow = now - windowStart < LOGIN_WINDOW_MS;

  const failedCount = withinWindow ? user.failedLoginCount + 1 : 1;
  const locked = failedCount >= MAX_FAILED_LOGINS;

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        failedLoginCount: failedCount,
        failedLoginWindowStart: withinWindow ? user.failedLoginWindowStart : new Date(now),
        lockedUntil: locked ? new Date(now + LOCK_DURATION_MS) : null,
      },
    },
  );

  return { failedCount, locked };
}

function maskIdentifier(identifier: string): string {
  if (identifier.includes('@')) return maskEmail(identifier);
  if (identifier.length <= 3) return '*'.repeat(identifier.length);
  return `${identifier.slice(0, 2)}${'*'.repeat(identifier.length - 2)}`;
}

/**
 * Policy description for the settings screen. Derived from the shared constants
 * rather than hard-coded, so it cannot drift from what registration enforces.
 */
