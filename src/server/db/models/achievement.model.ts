import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `achievements` — the catalogue. Seeded from `src/content`, editable later by
 * the admin system. `criteria` is an opaque object here so the catalogue can
 * grow new criteria kinds without a migration; the evaluator in
 * `src/server/game/achievements.ts` is the only thing that interprets it.
 */

export const ACHIEVEMENT_RARITIES = ['bronze', 'silver', 'gold', 'platinum'] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export interface AchievementDoc {
  _id: unknown;
  achievementId: string;
  title: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  hidden: boolean;
  criteria: Record<string, unknown>;
  xp: number;
  moduleId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const achievementSchema = defineSchema<AchievementDoc>(
  {
    achievementId: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 80 },
    description: { type: String, required: true, maxlength: 400 },
    icon: { type: String, required: true, maxlength: 40 },
    rarity: { type: String, required: true, enum: ACHIEVEMENT_RARITIES, default: 'bronze' },
    hidden: { type: Boolean, required: true, default: false },
    criteria: { type: Object, required: true, default: {} },
    xp: { type: Number, required: true, default: 0, min: 0 },
    moduleId: { type: String, default: null },
    order: { type: Number, required: true, default: 0 },
  },
  { collection: 'achievements' },
);

achievementSchema.index({ moduleId: 1, order: 1 });

export const AchievementModel = registerModel<AchievementDoc>('Achievement', achievementSchema);
