import 'server-only';

import { cookies } from 'next/headers';
import { connectDb } from '@/server/db/connect';
import { SessionModel } from '@/server/db/models/session.model';
import { UserModel, type UserDoc, type UserRole, type UserStatus } from '@/server/db/models/user.model';
import { ProfileModel } from '@/server/db/models/profile.model';
import { env, cookiesAreSecure } from '@/server/config/env';
import { generateSecret, hashToken, fingerprint } from './crypto';
import { auditDetached } from './audit';

/**
 * Server-side sessions.
 *
 * Threat model addressed here
 * ---------------------------
 * 1. *Stolen database*  → the cookie token is never stored; only SHA-256 of it.
 * 2. *Stolen cookie*     → bound to an IP-prefix-agnostic but UA-labelled record,
 *                          and revocable in one call.
 * 3. *Password change*  → `users.sessionEpoch` is incremented, which invalidates
 *                          every existing session at the next request.
 * 4. *XSS exfiltration*  → cookie is `HttpOnly`, so `document.cookie` cannot read
 *                          it. Nothing sensitive is mirrored into localStorage.
 * 5. *Session fixation* → the token is regenerated on every login and on every
 *                          privilege change; there is no anonymous pre-session.
 * 6. *Fixation via CSRF* → see `csrf.ts`; the session cookie is `SameSite=Lax`
 *                          and mutating routes require a matching CSRF token.
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

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: cookiesAreSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    // No `domain` — host-only cookie is the narrowest useful scope.
  };
}

export function sessionCookieName(): string {
  return env().SESSION_COOKIE_NAME;
}

export async function createSession(params: {
  userId: string;
  sessionEpoch: number;
  label: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
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

  auditDetached({
    event: 'auth.login.success',
    userId: params.userId,
    ip: params.ip,
    userAgent: params.userAgent,
    metadata: { sessionFingerprint: fingerprint(token), label: params.label },
  });

  const jar = await cookies();
  jar.set(sessionCookieName(), token, cookieOptions(ttlHours * 3_600));

  return { token, sessionId: String(doc._id), expiresAt };
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

export interface ResolvedSession {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Validates the session cookie against the database.
 *
 * Returns `null` for every failure mode — absent, malformed, unknown, expired,
 * revoked, or belonging to a user whose `sessionEpoch` has moved on. The caller
 * cannot distinguish them, which is exactly what we want.
 */
export async function resolveSession(): Promise<ResolvedSession | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
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

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    if (session.absoluteExpiresAt.getTime() <= Date.now()) return null;

    const user = (await UserModel.findById(session.userId, userProjection).lean()) as
      | (Pick<
          UserDoc,
          'username' | 'displayName' | 'role' | 'status' | 'emailVerified' | 'sessionEpoch'
        > & { _id: unknown })
      | null;

    if (!user) return null;
    if (user.status === 'banned' || user.status === 'suspended') return null;
    if (user.sessionEpoch !== session.sessionEpoch) return null;

    // Sliding refresh, bounded by the absolute ceiling.
    if (session.expiresAt.getTime() - Date.now() < SESSION_REFRESH_THRESHOLD_MS) {
      const ttlHours = env().SESSION_TTL_HOURS;
      const nextExpiry = new Date(Math.min(Date.now() + ttlHours * 3_600_000, session.absoluteExpiresAt.getTime()));
      await SessionModel.updateOne(
        { _id: session._id, tokenHash },
        { $set: { expiresAt: nextExpiry } },
      );
      const jar2 = await cookies();
      jar2.set(sessionCookieName(), token, cookieOptions(ttlHours * 3_600));
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

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) {
    await connectDb();
    await SessionModel.updateOne(
      { tokenHash: hashToken(token), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    );
  }
  jar.delete(sessionCookieName());
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

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<SessionInfo[]> {
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
