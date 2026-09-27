import 'server-only';

import { connectDb } from '@/server/db/connect';
import { SessionModel } from '@/server/db/models/session.model';
import { UserModel, type UserDoc, type UserRole, type UserStatus } from '@/server/db/models/user.model';
import { ProfileModel } from '@/server/db/models/profile.model';
import { env, cookiesAreSecure } from '@/server/config/env';
import { generateSecret, hashToken } from './crypto';
import { auditDetached } from './audit';
import type { CookieJar, CookieOptions } from './cookies';

/**
 * Server-side sessions.
 *
 * Threat model addressed here
 * ---------------------------
 * 1. *Stolen database*  → the cookie carries a random 256-bit token; only its
 *    SHA-256 digest is stored, so a dump cannot be replayed as a live session.
 * 2. *Stolen cookie*     → revocable in one indexed call, and visible to the
 *    owner in "active sessions" so a theft can be spotted and cut off.
 * 3. *Password change*  → `users.sessionEpoch` is incremented, invalidating every
 *    session minted before it with a single comparison per request.
 * 4. *XSS*              → the cookie is `HttpOnly`, so `document.cookie` cannot
 *    read it. Nothing sensitive is mirrored into localStorage.
 * 5. *Fixation*         → the token is regenerated on every login; there is no
 *    anonymous pre-session to poison.
 * 6. *CSRF*             → see `csrf.ts`; the cookie is `SameSite=Lax` and every
 *    mutating route additionally requires a matching CSRF token.
 */

const DAY_MS = 86_400_000;
const SESSION_REFRESH_THRESHOLD_MS = 15 * 60_000;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  sessionId: string;
  sessionFingerprint: string;
}

export interface SessionInfo {
  id: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  current: boolean;
}

export interface ResolvedSession {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
}

function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: cookiesAreSecure(),
    sameSite: 'lax',
    // No `domain` => host-only cookie, the narrowest useful scope.
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function sessionCookieName(): string {
  return env().SESSION_COOKIE_NAME;
}

export async function createSession(
  params: {
    userId: string;
    sessionEpoch: number;
    label: string;
    ip: string | null;
    userAgent: string | null;
  },
  jar: CookieJar,
): Promise<{ sessionId: string; expiresAt: Date }> {
  await connectDb();

  const token = generateSecret(32);
  const ttlHours = env().SESSION_TTL_HOURS;
  const now = Date.now();
  const expiresAt = new Date(now + ttlHours * 3_600_000);
  const absoluteExpiresAt = new Date(now + env().SESSION_ABSOLUTE_TTL_DAYS * DAY_MS);

  const doc = await SessionModel.create({
    tokenHash: hashToken(token),
    userId: params.userId,
    sessionEpoch: params.sessionEpoch,
    label: params.label,
    ip: params.ip,
    userAgent: params.userAgent,
    lastSeenAt: new Date(now),
    expiresAt,
    absoluteExpiresAt,
  });

  jar.set(sessionCookieName(), token, cookieOptions(ttlHours * 3_600));

  auditDetached({
    event: 'auth.login.success',
    userId: params.userId,
    ip: params.ip,
    userAgent: params.userAgent,
    metadata: { sessionId: String(doc._id), label: params.label },
  });

  return { sessionId: String(doc._id), expiresAt };
}

const userProjection = {
  username: 1,
  displayName: 1,
  role: 1,
  status: 1,
  emailVerified: 1,
  sessionEpoch: 1,
} as const;

interface SessionRow {
  _id: unknown;
  tokenHash: string;
  userId: string;
  sessionEpoch: number;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
  label: string;
  ip: string | null;
  userAgent: string | null;
}

type ProjectedUser = Pick<
  UserDoc,
  'username' | 'displayName' | 'role' | 'status' | 'emailVerified' | 'sessionEpoch'
> & { _id: unknown };

/**
 * Validates the session cookie against the database.
 *
 * Returns `null` for *every* failure mode — absent, malformed, unknown, expired,
 * revoked, or owned by a user whose `sessionEpoch` has moved on. The caller
 * cannot distinguish them, which is the point.
 */
export async function resolveSession(jar: CookieJar): Promise<ResolvedSession | null> {
  const token = jar.get(sessionCookieName());
  // Cheap length gate before touching the database.
  if (!token || token.length < 32 || token.length > 128) return null;

  try {
    await connectDb();
    const tokenHash = hashToken(token);

    const session = (await SessionModel.findOne({ tokenHash })
      .select({
        tokenHash: 1,
        userId: 1,
        sessionEpoch: 1,
        expiresAt: 1,
        absoluteExpiresAt: 1,
        revokedAt: 1,
        lastSeenAt: 1,
        label: 1,
        ip: 1,
        userAgent: 1,
      })
      .lean()) as SessionRow | null;

    if (!session || session.revokedAt) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (session.absoluteExpiresAt.getTime() <= now) return null;

    const user = (await UserModel.findById(session.userId, userProjection).lean()) as ProjectedUser | null;
    if (!user) return null;
    if (user.status === 'banned' || user.status === 'suspended') return null;
    if (user.sessionEpoch !== session.sessionEpoch) return null;

    // Sliding refresh, hard-bounded by the absolute ceiling.
    if (session.expiresAt.getTime() - now < SESSION_REFRESH_THRESHOLD_MS) {
      const ttlHours = env().SESSION_TTL_HOURS;
      const nextExpiry = new Date(
        Math.min(now + ttlHours * 3_600_000, session.absoluteExpiresAt.getTime()),
      );
      await SessionModel.updateOne({ _id: session._id, tokenHash }, { $set: { expiresAt: nextExpiry } });
      jar.set(sessionCookieName(), token, cookieOptions(ttlHours * 3_600));
    }

    return {
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        sessionId: String(session._id),
        sessionFingerprint: session.tokenHash.slice(0, 8),
      },
      sessionId: String(session._id),
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    console.error('[session] resolution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Convenience wrapper for Server Components, which can read but not write cookies. */
export async function resolveSessionFromRequest(request: Request): Promise<ResolvedSession | null> {
  const { createCookieJar, cookieSourceFromHeader } = await import('./cookies');
  return resolveSession(createCookieJar(cookieSourceFromHeader(request.headers.get('cookie'))));
}

export async function destroySessionByToken(token: string, reason = 'logout'): Promise<void> {
  await connectDb();
  await SessionModel.updateOne(
    { tokenHash: hashToken(token), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason.slice(0, 64) } },
  );
}

export function destroyCurrentSession(jar: CookieJar, token: string | undefined): Promise<void> {
  const done = token ? destroySessionByToken(token, 'logout') : Promise.resolve();
  jar.delete(sessionCookieName(), { path: '/', secure: cookiesAreSecure() });
  return done;
}

export async function revokeAllSessions(
  userId: string,
  reason: string,
  opts: { exceptSessionId?: string; bumpEpoch?: boolean } = {},
): Promise<number> {
  await connectDb();
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (opts.exceptSessionId) filter._id = { $ne: opts.exceptSessionId };

  const result = await SessionModel.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason.slice(0, 64) },
  });

  if (opts.bumpEpoch !== false) {
    await UserModel.updateOne({ _id: userId }, { $inc: { sessionEpoch: 1 } });
  }

  return result.modifiedCount;
}

export async function listSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
  await connectDb();
  const rows = await SessionModel.find({ userId, revokedAt: null })
    .sort({ lastSeenAt: -1 })
    .limit(25)
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    label: row.label,
    createdAt: new Date(row.createdAt),
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    ip: row.ip,
    current: String(row._id) === currentSessionId,
  }));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  await connectDb();
  // `userId` in the filter is the IDOR guard: a session id alone is not enough.
  const result = await SessionModel.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'user-revoked' } },
  );
  return result.modifiedCount > 0;
}

export async function ensureProfile(userId: string, displayName: string) {
  await connectDb();
  return ProfileModel.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        handle: displayName,
        avatarId: 'avatar-recruit',
        unlockedModules: ['networking'],
        unlockedLevels: ['networking.l1'],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
