/**
 * Progression primitives shared by the client, the game engine and the server.
 *
 * Nothing in this file may import from `server-only`. It is the vocabulary both
 * sides agree on; the *authority* for these values lives on the server.
 */

export const TIER_IDS = ['beginner', 'basic', 'intermediate', 'advanced', 'expert'] as const;
export type TierId = (typeof TIER_IDS)[number];

export const TIER_ORDER: Record<TierId, number> = {
  beginner: 0,
  basic: 1,
  intermediate: 2,
  advanced: 3,
  expert: 4,
};

export const TIER_META: Record<TierId, { label: string; color: string; description: string }> = {
  beginner: {
    label: 'Beginner',
    color: 'var(--color-tier-beginner)',
    description: 'First contact. Concepts are introduced with heavy scaffolding.',
  },
  basic: {
    label: 'Basic',
    color: 'var(--color-tier-basic)',
    description: 'You recognise the parts and can wire them correctly.',
  },
  intermediate: {
    label: 'Intermediate',
    color: 'var(--color-tier-intermediate)',
    description: 'Multiple concepts combine; you reason about why a config fails.',
  },
  advanced: {
    label: 'Advanced',
    color: 'var(--color-tier-advanced)',
    description: 'Ambiguous symptoms, realistic constraints, no hand-holding.',
  },
  expert: {
    label: 'Expert',
    color: 'var(--color-tier-expert)',
    description: 'Attacks, defence and trade-offs. Diagnosis under pressure.',
  },
};

export function tierRank(tier: TierId): number {
  return TIER_ORDER[tier];
}

export function atLeastTier(actual: TierId, required: TierId): boolean {
  return TIER_ORDER[actual] >= TIER_ORDER[required];
}

export const MISSION_STATUSES = [
  'locked',
  'available',
  'in_progress',
  'completed',
  'mastered',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const LEVEL_STATUSES = [
  'locked',
  'available',
  'in_progress',
  'completed',
  'mastered',
] as const;
export type LevelStatus = (typeof LEVEL_STATUSES)[number];

/** Base XP required to advance *from* the given level (1-indexed). */
export function xpToAdvance(level: number, base = 500, step = 350): number {
  return base + (Math.max(1, level) - 1) * step;
}

/**
 * Deterministic level curve. Pure so the client can render a progress bar and
 * the server can recompute it independently — and so both agree by construction.
 */
export function levelFromXp(
  xp: number,
  base = 500,
  step = 350,
): {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
} {
  let remaining = Math.max(0, Math.floor(xp));
  let level = 1;
  let needed = xpToAdvance(level, base, step);

  // Bounded loop: xp is capped at 10^9 by the schema, so at most ~2.8M steps,
  // but the guard keeps a malformed value from hanging the request.
  let guard = 0;
  while (remaining >= needed && guard < 1000) {
    remaining -= needed;
    level += 1;
    needed = xpToAdvance(level, base, step);
    guard += 1;
  }

  return { level, xpIntoLevel: remaining, xpForNextLevel: needed };
}

export function tierForLevel(level: number): TierId {
  if (level >= 21) return 'expert';
  if (level >= 15) return 'advanced';
  if (level >= 9) return 'intermediate';
  if (level >= 4) return 'basic';
  return 'beginner';
}

export function progressPercent(xpIntoLevel: number, xpForNextLevel: number): number {
  if (xpForNextLevel <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)));
}

/** `YYYY-MM-DD` in UTC. Streaks are counted in whole UTC days. */
export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetweenUtc(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Streak update. Idempotent for a given day: playing twice in one day does not
 * double-count, and a missed day resets to 1 rather than to 0.
 */
export function nextStreak(
  current: { streakDays: number; longestStreakDays: number; lastActiveDay: string | null },
  today: string = utcDayKey(),
): { streakDays: number; longestStreakDays: number; lastActiveDay: string } {
  if (!current.lastActiveDay) {
    return {
      streakDays: 1,
      longestStreakDays: Math.max(1, current.longestStreakDays),
      lastActiveDay: today,
    };
  }
  const gap = daysBetweenUtc(current.lastActiveDay, today);
  if (gap === 0) {
    return { ...current, lastActiveDay: today };
  }
  if (gap === 1) {
    const streakDays = current.streakDays + 1;
    return {
      streakDays,
      longestStreakDays: Math.max(current.longestStreakDays, streakDays),
      lastActiveDay: today,
    };
  }
  return {
    streakDays: 1,
    longestStreakDays: Math.max(current.longestStreakDays, 1),
    lastActiveDay: today,
  };
}

export const XP_EVENT_KINDS = [
  'mission_completed',
  'challenge_first_try',
  'challenge_completed',
  'level_completed',
  'module_completed',
  'achievement_unlocked',
  'daily_bonus',
] as const;
export type XpEventKind = (typeof XP_EVENT_KINDS)[number];

/** Named multipliers so the economy can be tuned from one place. */
export const XP_MULTIPLIERS: Record<XpEventKind, number> = {
  mission_completed: 1,
  challenge_first_try: 0.5,
  challenge_completed: 0.25,
  level_completed: 1.5,
  module_completed: 3,
  achievement_unlocked: 0,
  daily_bonus: 1,
};
