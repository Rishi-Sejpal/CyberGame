import type { TierId } from '@/game/types/progression';

/**
 * The account and progression shapes that cross the wire.
 *
 * These are the **serialised** types: dates are ISO-8601 strings, because that
 * is what `JSON.stringify` produces and what `JSON.parse` gives back. Declaring
 * them here — rather than letting the server hand out `Date` and the client
 * guess — removes the single most common source of a subtle client bug, where
 * `new Date(user.createdAt).toISOString()` works in one place and throws in
 * another because the value was already a string.
 *
 * The server's `toPublicUser` returns `AccountView` and the Client Components
 * import it, so a field can never be added on one side only.
 *
 * What is deliberately absent: `passwordHash`, `emailLookupHash`,
 * `sessionEpoch`, `lastLoginIp`, and any raw token. The projection functions
 * that build these objects are the boundary, and adding a field here is a
 * reviewable act.
 */

export const ACCOUNT_ROLES = ['player', 'moderator', 'admin'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'suspended', 'banned'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Statuses that may hold a session. Mirrors the check in `resolveSession`. */
export const ACTIVE_STATUSES: ReadonlySet<AccountStatus> = new Set<AccountStatus>([
  'active',
  'pending_verification',
]);

export interface AccountView {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  emailVerified: boolean;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601 or null. */
  lastLoginAt: string | null;
}

/**
 * Lifetime counters. Display-only: nothing here is ever accepted back from the
 * client. The progression service is the sole writer, and `/api/profile` reads
 * it through a projection.
 */
export interface PlayerStats {
  missionsCompleted: number;
  challengesSolved: number;
  totalAttempts: number;
  totalHintsUsed: number;
  modulesCompleted: number;
  levelsCompleted: number;
  perfectMissions: number;
  fastestMissionMs: number | null;
  playTimeMs: number;
  packetsInspected: number;
  packetsFlagged: number;
  devicesConfigured: number;
  puzzlesSolved: number;
}

export interface ProfileView {
  handle: string;
  avatarId: string;
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  tier: TierId;
  streakDays: number;
  stats: PlayerStats;
}

export const ZERO_STATS: PlayerStats = {
  missionsCompleted: 0,
  challengesSolved: 0,
  totalAttempts: 0,
  totalHintsUsed: 0,
  modulesCompleted: 0,
  levelsCompleted: 0,
  perfectMissions: 0,
  fastestMissionMs: null,
  playTimeMs: 0,
  packetsInspected: 0,
  packetsFlagged: 0,
  devicesConfigured: 0,
  puzzlesSolved: 0,
};

/** Narrows an unknown value to a known tier, falling back rather than throwing. */
export function asTierId(value: unknown): TierId {
  return value === 'basic' ||
    value === 'intermediate' ||
    value === 'advanced' ||
    value === 'expert' ||
    value === 'beginner'
    ? value
    : 'beginner';
}

/** Fills in any stat the server omitted, so the UI never renders `undefined`. */
export function normalizeStats(raw: unknown): PlayerStats {
  if (typeof raw !== 'object' || raw === null) return { ...ZERO_STATS };
  const source = raw as Record<string, unknown>;
  const out = { ...ZERO_STATS };
  for (const key of Object.keys(ZERO_STATS) as Array<keyof PlayerStats>) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export interface SessionInfoView {
  id: string;
  label: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. */
  lastSeenAt: string;
  /** ISO-8601. */
  expiresAt: string;
  ip: string | null;
  current: boolean;
}

/** ISO-8601 formatter used wherever a `Date` must become a wire value. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}
