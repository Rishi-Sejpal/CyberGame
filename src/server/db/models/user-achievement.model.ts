import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `userAchievements` — what a specific player has unlocked, and when.
 *
 * The unique index on (userId, achievementId) is what makes awarding
 * idempotent: a concurrent double-completion cannot produce two rows, and the
 * duplicate-key error is the signal to skip the XP grant.
 */

export interface UserAchievementDoc {
  _id: unknown;
  userId: string;
  achievementId: string;
  unlockedAt: Date;
  /** Snapshot for display; the catalogue may be edited later. */
  title: string;
  description: string;
  icon: string;
  rarity: string;
  xp: number;
  /** What triggered it, for the "recent unlocks" feed. */
  context: Record<string, unknown>;
  /** True when the player has not dismissed the toast yet. */
  seen: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userAchievementSchema = defineSchema<UserAchievementDoc>(
  {
    userId: { type: String, required: true },
    achievementId: { type: String, required: true },
    unlockedAt: { type: Date, required: true, default: () => new Date() },
    title: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, required: true },
    rarity: { type: String, required: true, default: 'bronze' },
    xp: { type: Number, required: true, default: 0, min: 0 },
    context: { type: Object, default: {} },
    seen: { type: Boolean, required: true, default: false },
  },
  { collection: 'userAchievements' },
);

userAchievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });
userAchievementSchema.index({ userId: 1, unlockedAt: -1 });
userAchievementSchema.index({ userId: 1, seen: 1 });

export const UserAchievementModel = registerModel<UserAchievementDoc>(
  'UserAchievement',
  userAchievementSchema,
);
