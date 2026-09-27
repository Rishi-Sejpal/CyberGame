/**
 * Content authoring contract.
 *
 * A "module" (Networking today; Web Security, Cryptography, Digital Forensics
 * and the rest tomorrow) is pure data expressed in these types. Adding a module
 * means adding content — never touching the engine, the API, or the progression
 * service. The `CHALLENGE_KINDS` registry is the single extension point when a
 * module genuinely needs a *new mechanic*; reusing an existing kind is the norm.
 */

import type { TierId } from './progression';

// ---------------------------------------------------------------------------
// Mechanics registry
// ---------------------------------------------------------------------------

/**
 * Every playable interaction the engine knows how to render. Each id maps to a
 * React mechanic component (`src/components/game/mechanics/`) and, for the
 * spatial ones, a Phaser interaction scene.
 *
 * `spatial: true` means the mechanic happens inside the world (walk to a device,
 * drag a cable). `spatial: false` means it opens as a focused UI panel.
 */
export const CHALLENGE_KINDS = [
  // L1–L2 foundations
  'identify-device',
  'wire-network',
  'topology-build',
  'configure-host',
  // L3 protocols
  'protocol-match',
  'handshake-trace',
  // L4 the signature mechanic
  'packet-journey',
  'packet-inspect',
  // L5 OSI
  'osi-stack',
  'osi-encapsulation',
  // L6 addressing
  'subnet-lab',
  'address-plan',
  // L7 operations
  'diagnose',
  'fix-config',
  // L8 defence
  'firewall-rules',
  'segmentation',
  'anomaly-triage',
  'mitm-detect',
  // occasional, only where it genuinely fits
  'checkpoint',
] as const;

export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

export const CHALLENGE_KIND_META: Record<ChallengeKind, { spatial: boolean; label: string }> = {
  'identify-device': { spatial: true, label: 'Field identification' },
  'wire-network': { spatial: true, label: 'Cabling' },
  'topology-build': { spatial: true, label: 'Topology design' },
  'configure-host': { spatial: false, label: 'Device configuration' },
  'protocol-match': { spatial: false, label: 'Service mapping' },
  'handshake-trace': { spatial: false, label: 'Connection trace' },
  'packet-journey': { spatial: false, label: 'Packet journey' },
  'packet-inspect': { spatial: false, label: 'Packet inspection' },
  'osi-stack': { spatial: false, label: 'Layer stack' },
  'osi-encapsulation': { spatial: false, label: 'Encapsulation' },
  'subnet-lab': { spatial: false, label: 'Subnet lab' },
  'address-plan': { spatial: false, label: 'Address plan' },
  diagnose: { spatial: true, label: 'Fault diagnosis' },
  'fix-config': { spatial: false, label: 'Apply fix' },
  'firewall-rules': { spatial: false, label: 'Firewall' },
  segmentation: { spatial: true, label: 'Segmentation' },
  'anomaly-triage': { spatial: false, label: 'Traffic triage' },
  'mitm-detect': { spatial: false, label: 'Interception analysis' },
  checkpoint: { spatial: false, label: 'Knowledge checkpoint' },
};

// ---------------------------------------------------------------------------
// Unlock rules
// ---------------------------------------------------------------------------

export interface UnlockRule {
  /** All of these mission ids must be `completed` or better. */
  requiresMissionIds?: string[];
  /** All of these level ids must be `completed` or better. */
  requiresLevelIds?: string[];
  /** Minimum player level. Server-evaluated only. */
  requiresPlayerLevel?: number;
  /** Free-form badge shown in the UI when the content is still locked. */
  label?: string;
}

export function isUnlockSatisfied(
  rule: UnlockRule | undefined,
  ctx: {
    completedMissionIds: ReadonlySet<string>;
    completedLevelIds: ReadonlySet<string>;
    playerLevel: number;
  },
): boolean {
  if (!rule) return true;
  if (rule.requiresPlayerLevel !== undefined && ctx.playerLevel < rule.requiresPlayerLevel) {
    return false;
  }
  for (const id of rule.requiresMissionIds ?? []) {
    if (!ctx.completedMissionIds.has(id)) return false;
  }
  for (const id of rule.requiresLevelIds ?? []) {
    if (!ctx.completedLevelIds.has(id)) return false;
  }
  return true;
}

export function describeUnlock(rule: UnlockRule | undefined): string {
  if (!rule) return 'Open from the start';
  const parts: string[] = [];
  if (rule.requiresPlayerLevel !== undefined) parts.push(`Reach level ${rule.requiresPlayerLevel}`);
  const missions = rule.requiresMissionIds?.length ?? 0;
  if (missions) parts.push(`Complete ${missions} earlier mission${missions > 1 ? 's' : ''}`);
  const levels = rule.requiresLevelIds?.length ?? 0;
  if (levels) parts.push(`Finish ${levels} level${levels > 1 ? 's' : ''}`);
  return parts.join(' · ') || 'Open from the start';
}

// ---------------------------------------------------------------------------
// Learning metadata (required on every challenge)
// ---------------------------------------------------------------------------

export interface LearningMetadata {
  /** The single idea this challenge teaches, e.g. "subnet-mask". */
  concept: string;
  difficulty: TierId;
  /** Student-facing statement of what they should be able to do afterwards. */
  learningObjective: string;
  /** Concepts that should already be understood. Used for unlock gating. */
  prerequisiteConcepts: string[];
  /** Optional nudge. Costs a hint token, never blocks a retry. */
  hint: string;
  /** Shown after a correct answer, and after a wrong answer on request. */
  solutionExplanation: string;
  /** Optional reference links (in-app glossary entries, never external by default). */
  references?: string[];
}

export function isCompleteLearningMetadata(meta: Partial<LearningMetadata> | undefined): meta is LearningMetadata {
  return Boolean(
    meta &&
      meta.concept &&
      meta.difficulty &&
      meta.learningObjective &&
      Array.isArray(meta.prerequisiteConcepts) &&
      meta.hint &&
      meta.solutionExplanation,
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const ITEM_KINDS = [
  'tool',
  'badge',
  'key-item',
  'cosmetic',
  'schematic',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemDefinition {
  id: string;
  name: string;
  kind: ItemKind;
  description: string;
  /** ASCII pixel art key resolved by the asset registry. */
  sprite?: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  /** Purely cosmetic + flavour; never affects puzzle validation. */
  effect?: string;
}

// ---------------------------------------------------------------------------
// Module / level / mission / challenge
// ---------------------------------------------------------------------------

export interface ModuleDefinition {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  order: number;
  accent: string;
  icon: string;
  /** `false` until the module ships. Locked modules render as "classified". */
  available: boolean;
  /** Player level required to even see the module map. */
  unlock?: UnlockRule;
  /** Modules that must be finished first (e.g. Cryptography after Networking). */
  prerequisiteModuleIds?: string[];
  totalXp: number;
}

export interface LevelDefinition {
  id: string;
  moduleId: string;
  index: number;
  title: string;
  summary: string;
  tier: TierId;
  /** Scene the player is dropped into, and the anchor tile. */
  scene: { world: string; spawn?: { x: number; y: number } };
  unlock?: UnlockRule;
  /** The concept ids this level introduces — shown on the level card. */
  teaches: string[];
  briefing: string;
}

export interface Objective {
  id: string;
  text: string;
  /** Objectives are checkpoints, not score. The server tracks them. */
  optional?: boolean;
}

export interface RewardBundle {
  xp: number;
  items?: Array<{ itemId: string; quantity: number }>;
  /** Cosmetic player titles, purely for flavour. */
  title?: string;
}

export interface MissionDefinition {
  id: string;
  moduleId: string;
  levelId: string;
  index: number;
  title: string;
  brief: string;
  /** NPC who hands out / closes the mission. */
  giverNpcId: string;
  /** Where the player interacts with the mission in the world. */
  worldAnchor: { x: number; y: number };
  icon: string;
  objectives: Objective[];
  unlock?: UnlockRule;
  rewards: RewardBundle;
  /** Missions that become available once this one is done. */
  unlocksMissionIds?: string[];
  estimatedMinutes: number;
}

export interface ChallengeDefinition {
  id: string;
  missionId: string;
  moduleId: string;
  levelId: string;
  index: number;
  kind: ChallengeKind;
  prompt: string;
  /** Narrative framing shown above the mechanic. */
  flavour?: string;
  learning: LearningMetadata;
  /** Attacking the mechanic is never punished; the counter only feeds stats. */
  maxAttempts?: number;
  /** Kind-specific payload. `solution` inside here is server-only. */
  data: ChallengeData;
  rewards: RewardBundle;
}

export type ChallengeData = Record<string, unknown> & { solution?: unknown };

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Hidden achievements are not listed until earned. */
  hidden?: boolean;
  /** How the server decides whether it has been earned. */
  criteria: AchievementCriteria;
  xp: number;
}

export type AchievementCriteria =
  | { kind: 'mission-completed'; missionIds: string[] }
  | { kind: 'mission-completed-in-module'; moduleId: string; count: number }
  | { kind: 'level-completed'; levelIds: string[] }
  | { kind: 'module-completed'; moduleId: string }
  | { kind: 'challenge-kind-mastered'; challengeKind: ChallengeKind; count: number }
  | { kind: 'streak'; days: number }
  | { kind: 'level-reached'; level: number }
  | { kind: 'perfect-missions'; count: number }
  | { kind: 'packets-flagged'; count: number }
  | { kind: 'no-hints-level'; levelId: string }
  | { kind: 'collect-item'; itemIds: string[] };

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export const NPC_ARCHETYPES = [
  'mentor',
  'network-engineer',
  'student-rival',
  'sysadmin',
  'investigator',
  'mystery',
] as const;
export type NpcArchetype = (typeof NPC_ARCHETYPES)[number];

export interface DialogueLine {
  speaker: string;
  /** `condition` is evaluated against sanitised player state. */
  text: string;
  condition?: DialogueCondition;
  /** Portrait expression, resolved by the asset registry. */
  expression?: 'neutral' | 'happy' | 'worried' | 'thinking' | 'excited' | 'smirk';
  /** Camera cue when this line is shown. */
  focus?: { type: 'npc' | 'device' | 'none'; id?: string };
}

export type DialogueCondition =
  | { kind: 'mission-status'; missionId: string; status: 'available' | 'in_progress' | 'completed' }
  | { kind: 'level-completed'; levelId: string }
  | { kind: 'stat-at-least'; stat: string; value: number }
  | { kind: 'always' }
  | { kind: 'never' };

export interface DialogueTree {
  id: string;
  npcId: string;
  lines: DialogueLine[];
  /** Optional next tree, enabling short branching conversations. */
  next?: string;
  /** Attached mission offered by this tree. */
  offerMissionId?: string;
  /** When set, reaching the end of the tree marks the mission accepted. */
  acceptsMissionId?: string;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  archetype: NpcArchetype;
  title: string;
  /** One-line hook shown in dialogue UI. */
  tagline: string;
  bio: string;
  /** Palette + sprite keys. Adding a character = adding a record here. */
  sprite: { key: string; palette: string };
  homeWorld: string;
  homePosition: { x: number; y: number };
  /** Personality knobs that colour the generated voice lines. */
  voice: {
    formality: 'casual' | 'neutral' | 'formal';
    verbosity: 'terse' | 'normal' | 'talkative';
    signature?: string;
  };
}

// ---------------------------------------------------------------------------
// Aggregated content graph
// ---------------------------------------------------------------------------

export interface ModuleContent {
  module: ModuleDefinition;
  levels: Array<LevelDefinition & { missions: MissionDefinition[] }>;
}

export interface GameContent {
  modules: ModuleDefinition[];
  levels: LevelDefinition[];
  missions: MissionDefinition[];
  challenges: ChallengeDefinition[];
  characters: CharacterDefinition[];
  dialogue: DialogueTree[];
  items: ItemDefinition[];
  achievements: AchievementDefinition[];
}
