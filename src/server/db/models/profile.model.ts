import 'server-only';

import { defineSchema, registerModel } from '../model-kit';
import { TIER_IDS, type TierId } from '@/game/types/progression';

/**
 * `profiles` — the aggregate player record.
 *
 * This is the *only* place a player's XP/level/streak lives. It is written
 * exclusively by the server-side progression service, which:
 *   1. re-derives the level from the XP curve,
 *   2. derives XP from validated mission outcomes (never from the request),
 *   3. performs the update inside `findOneAndUpdate` with `$inc` on XP so two
 *      concurrent completions cannot clobber each other.
 *
 * `stats` is a rollup maintained transactionally alongside XP. It exists so
 * the dashboard does not have to aggregate the whole `progress` collection.
 */

export const XP_CURVE_BASE = 500;
export const XP_CURVE_STEP = 350;

export interface ProfileStats {
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

export interface ProfileDoc {
  _id: unknown;
  userId: string;
  handle: string;
  avatarId: string;
  xp: number;
  level: number;
  /** Cumulative XP banked toward the next level; derived, never trusted. */
  xpIntoLevel: number;
  xpForNextLevel: number;
  tier: TierId;
  streakDays: number;
  longestStreakDays: number;
  lastActiveDay: string | null;
  unlockedModules: string[];
  unlockedLevels: string[];
  stats: ProfileStats;
  /** Tracked separately so a "resend verification" flow can be rate limited. */
  verificationEmailSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const EMPTY_STATS: ProfileStats = {
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

const profileSchema = defineSchema<ProfileDoc>(
  {
    userId: { type: String, required: true, unique: true },
    handle: { type: String, required: true, maxlength: 32 },
    avatarId: { type: String, required: true, default: 'avatar-recruit', maxlength: 40 },
    xp: { type: Number, required: true, default: 0, min: 0 },
    level: { type: Number, required: true, default: 1, min: 1, max: 999 },
    xpIntoLevel: { type: Number, required: true, default: 0, min: 0 },
    xpForNextLevel: { type: Number, required: true, default: XP_CURVE_BASE, min: 1 },
    tier: { type: String, required: true, enum: TIER_IDS, default: 'beginner' },
    streakDays: { type: Number, required: true, default: 0, min: 0 },
    longestStreakDays: { type: Number, required: true, default: 0, min: 0 },
    /** `YYYY-MM-DD` in UTC — the unit the streak is counted in. */
    lastActiveDay: { type: String, default: null, maxlength: 10 },
    unlockedModules: { type: [String], default: [] },
    unlockedLevels: { type: [String], default: [] },
    stats: { type: Object, default: () => ({ ...EMPTY_STATS }) },
    verificationEmailSentAt: { type: Date, default: null },
  },
  { collection: 'profiles' },
);

profileSchema.index({ xp: -1 });
profileSchema.index({ tier: 1, xp: -1 });

export const ProfileModel = registerModel<ProfileDoc>('Profile', profileSchema);
