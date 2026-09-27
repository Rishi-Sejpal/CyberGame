import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * Content catalogue collections.
 *
 * These mirror the TypeScript definitions in `src/content` — that folder is the
 * authoring source and the seed script writes it here — but at runtime the
 * server reads content from Mongo. That split is deliberate:
 *
 *   - `src/content`  → reviewable, type-checked, diffable content
 *   - Mongo          → hot-swappable, admin-editable, versioned at runtime
 *
 * The `solution` payload of a challenge is stored here and is NEVER projected
 * into a client response. `sanitizeMission()` in the content service is the only
 * bridge between the two worlds.
 */

export interface ModuleDoc {
  _id: unknown;
  moduleId: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  order: number;
  accent: string;
  icon: string;
  available: boolean;
  unlock: Record<string, unknown> | null;
  prerequisiteModuleIds: string[];
  totalXp: number;
  /** Bumped by the admin editor; used for cache invalidation. */
  revision: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ModuleModel = registerModel<ModuleDoc>(
  'Module',
  defineSchema<ModuleDoc>(
    {
      moduleId: { type: String, required: true, unique: true },
      slug: { type: String, required: true, unique: true },
      title: { type: String, required: true },
      tagline: { type: String, required: true, default: '' },
      description: { type: String, required: true, default: '' },
      order: { type: Number, required: true, default: 0 },
      accent: { type: String, required: true, default: '#3ff5c0' },
      icon: { type: String, required: true, default: 'icon-module' },
      available: { type: Boolean, required: true, default: false },
      unlock: { type: Object, default: null },
      prerequisiteModuleIds: { type: [String], default: [] },
      totalXp: { type: Number, required: true, default: 0, min: 0 },
      revision: { type: Number, required: true, default: 1, min: 1 },
      publishedAt: { type: Date, default: null },
    },
    { collection: 'modules' },
  ),
);

export interface LevelDoc {
  _id: unknown;
  levelId: string;
  moduleId: string;
  index: number;
  title: string;
  summary: string;
  tier: string;
  scene: Record<string, unknown>;
  unlock: Record<string, unknown> | null;
  teaches: string[];
  briefing: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const LevelModel = registerModel<LevelDoc>(
  'Level',
  defineSchema<LevelDoc>(
    {
      levelId: { type: String, required: true, unique: true },
      moduleId: { type: String, required: true, index: true },
      index: { type: Number, required: true, min: 1 },
      title: { type: String, required: true },
      summary: { type: String, required: true, default: '' },
      tier: { type: String, required: true },
      scene: { type: Object, required: true, default: {} },
      unlock: { type: Object, default: null },
      teaches: { type: [String], default: [] },
      briefing: { type: String, required: true, default: '' },
      revision: { type: Number, required: true, default: 1, min: 1 },
    },
    { collection: 'levels' },
  ),
);

LevelModel.schema.index({ moduleId: 1, index: 1 }, { unique: true });

export interface MissionDoc {
  _id: unknown;
  missionId: string;
  moduleId: string;
  levelId: string;
  index: number;
  title: string;
  brief: string;
  giverNpcId: string;
  worldAnchor: { x: number; y: number };
  icon: string;
  objectives: Array<Record<string, unknown>>;
  unlock: Record<string, unknown> | null;
  rewards: Record<string, unknown>;
  unlocksMissionIds: string[];
  estimatedMinutes: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const MissionModel = registerModel<MissionDoc>(
  'Mission',
  defineSchema<MissionDoc>(
    {
      missionId: { type: String, required: true, unique: true },
      moduleId: { type: String, required: true, index: true },
      levelId: { type: String, required: true, index: true },
      index: { type: Number, required: true, min: 1 },
      title: { type: String, required: true },
      brief: { type: String, required: true, default: '' },
      giverNpcId: { type: String, required: true },
      worldAnchor: {
        type: {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
        },
        required: true,
        _id: false,
      },
      icon: { type: String, required: true, default: 'icon-mission' },
      objectives: { type: [Object], default: [] },
      unlock: { type: Object, default: null },
      rewards: { type: Object, required: true, default: {} },
      unlocksMissionIds: { type: [String], default: [] },
      estimatedMinutes: { type: Number, required: true, default: 10, min: 1 },
      revision: { type: Number, required: true, default: 1, min: 1 },
    },
    { collection: 'missions' },
  ),
);

MissionModel.schema.index({ moduleId: 1, levelId: 1, index: 1 }, { unique: true });

export interface ChallengeDoc {
  _id: unknown;
  challengeId: string;
  missionId: string;
  moduleId: string;
  levelId: string;
  index: number;
  kind: string;
  prompt: string;
  flavour: string | null;
  learning: Record<string, unknown>;
  maxAttempts: number | null;
  /** Contains the authoritative answer key. Never serialised to the client. */
  data: Record<string, unknown>;
  rewards: Record<string, unknown>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ChallengeModel = registerModel<ChallengeDoc>(
  'Challenge',
  defineSchema<ChallengeDoc>(
    {
      challengeId: { type: String, required: true, unique: true },
      missionId: { type: String, required: true, index: true },
      moduleId: { type: String, required: true, index: true },
      levelId: { type: String, required: true, index: true },
      index: { type: Number, required: true, min: 1 },
      kind: { type: String, required: true },
      prompt: { type: String, required: true },
      flavour: { type: String, default: null },
      learning: { type: Object, required: true },
      maxAttempts: { type: Number, default: null },
      data: { type: Object, required: true, default: {} },
      rewards: { type: Object, required: true, default: {} },
      revision: { type: Number, required: true, default: 1, min: 1 },
    },
    { collection: 'challenges' },
  ),
);

ChallengeModel.schema.index({ missionId: 1, index: 1 }, { unique: true });
ChallengeModel.schema.index({ moduleId: 1, kind: 1 });

export interface CharacterDoc {
  _id: unknown;
  characterId: string;
  name: string;
  archetype: string;
  title: string;
  tagline: string;
  bio: string;
  sprite: Record<string, unknown>;
  homeWorld: string;
  homePosition: { x: number; y: number };
  voice: Record<string, unknown>;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const CharacterModel = registerModel<CharacterDoc>(
  'Character',
  defineSchema<CharacterDoc>(
    {
      characterId: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      archetype: { type: String, required: true },
      title: { type: String, required: true, default: '' },
      tagline: { type: String, required: true, default: '' },
      bio: { type: String, required: true, default: '' },
      sprite: { type: Object, required: true, default: {} },
      homeWorld: { type: String, required: true, default: 'atrium' },
      homePosition: {
        type: {
          x: { type: Number, required: true },
          y: { type: Number, required: true },
        },
        required: true,
        _id: false,
      },
      voice: { type: Object, default: {} },
      revision: { type: Number, required: true, default: 1, min: 1 },
    },
    { collection: 'characters' },
  ),
);

export interface DialogueDoc {
  _id: unknown;
  dialogueId: string;
  npcId: string;
  lines: Array<Record<string, unknown>>;
  next: string | null;
  offerMissionId: string | null;
  acceptsMissionId: string | null;
  priority: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DialogueModel = registerModel<DialogueDoc>(
  'Dialogue',
  defineSchema<DialogueDoc>(
    {
      dialogueId: { type: String, required: true, unique: true },
      npcId: { type: String, required: true, index: true },
      lines: { type: [Object], default: [] },
      next: { type: String, default: null },
      offerMissionId: { type: String, default: null },
      acceptsMissionId: { type: String, default: null },
      priority: { type: Number, required: true, default: 0 },
      revision: { type: Number, required: true, default: 1, min: 1 },
    },
    { collection: 'dialogue' },
  ),
);

export interface ItemDoc {
  _id: unknown;
  itemId: string;
  name: string;
  kind: string;
  description: string;
  sprite: string | null;
  rarity: string;
  effect: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ItemModel = registerModel<ItemDoc>(
  'Item',
  defineSchema<ItemDoc>(
    {
      itemId: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      kind: { type: String, required: true },
      description: { type: String, required: true, default: '' },
      sprite: { type: String, default: null },
      rarity: { type: String, required: true, default: 'common' },
      effect: { type: String, default: null },
    },
    { collection: 'items' },
  ),
);
