import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `gameSaves` — where the player physically is and what they have open.
 *
 * Strictly cosmetic/continuity state: world id, tile position, facing, last
 * scene, settings. It contains NO progression — no XP, no unlocked missions, no
 * inventory. Those are re-derived from `profiles` + `progress` on every load, so
 * a tampered save can at worst teleport the avatar.
 *
 * The shape is validated by `GameSaveShape` (zod) on write, and the client only
 * ever sends a candidate save; the server clamps coordinates to world bounds.
 */

export interface GameSaveDoc {
  _id: unknown;
  userId: string;
  worldId: string;
  sceneKey: string;
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  /** The mission the player currently has in flight, if any. */
  activeMissionId: string | null;
  /** The mechanic panel the player last had open, so the UI can restore it. */
  openPanel: string | null;
  /** Free-form UI preferences (text size, reduced motion, ...). */
  settings: Record<string, boolean | string | number>;
  /** Monotonic counter, incremented on every write; guards against rollback. */
  revision: number;
  savedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const gameSaveSchema = defineSchema<GameSaveDoc>(
  {
    userId: { type: String, required: true, unique: true },
    worldId: { type: String, required: true, default: 'atrium', maxlength: 40 },
    sceneKey: { type: String, required: true, default: 'World', maxlength: 60 },
    x: { type: Number, required: true, default: 0 },
    y: { type: Number, required: true, default: 0 },
    facing: { type: String, required: true, enum: ['up', 'down', 'left', 'right'], default: 'down' },
    activeMissionId: { type: String, default: null, maxlength: 60 },
    openPanel: { type: String, default: null, maxlength: 60 },
    settings: { type: Object, default: {} },
    revision: { type: Number, required: true, default: 0, min: 0 },
    savedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'gameSaves' },
);

export const GameSaveModel = registerModel<GameSaveDoc>('GameSave', gameSaveSchema);
