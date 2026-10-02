import 'server-only';

import { defineSchema, registerModel } from '../model-kit';
import type { MissionStatus } from '@/game/types/progression';
import { MISSION_STATUSES } from '@/game/types/progression';

/**
 * `progress` — one document per (user, mission).
 *
 * This is the anti-cheat ledger. A client can only *propose* an attempt; this
 * collection is what the server writes after validating the attempt against the
 * authoritative challenge solutions, and it is the sole input to XP awards,
 * unlocks, achievements and level completion.
 *
 * `attemptNonce`/`resultHash` make replays detectable: a repeated
 * `attemptId` that the server has already scored returns the stored result
 * rather than awarding again.
 */

export interface ChallengeProgress {
  challengeId: string;
  status: 'locked' | 'available' | 'in_progress' | 'completed' | 'mastered';
  attempts: number;
  hintsUsed: number;
  firstTry: boolean;
  bestAccuracy: number;
  completedAt: Date | null;
  /** Server-computed; never accepted from the client. */
  xpAwarded: number;
}

export interface ProgressDoc {
  _id: unknown;
  userId: string;
  moduleId: string;
  levelId: string;
  missionId: string;
  status: MissionStatus;
  attempts: number;
  challenges: ChallengeProgress[];
  objectives: Array<{ id: string; done: boolean; at: Date | null }>;
  /** Client-declared total time; sanity-clamped server-side. */
  durationMs: number;
  hintsUsed: number;
  /** No hint, no wrong answer. Feeds the "flawless" achievement. */
  flawless: boolean;
  score: number;
  maxScore: number;
  completedAt: Date | null;
  /** Cumulative XP granted for this mission. Written exactly once. */
  xpAwarded: number;
  /** Anti-replay: the last `attemptId` the server scored for this mission. */
  lastAttemptId: string | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const challengeProgressSchema = defineSchema<ChallengeProgress>(
  {
    challengeId: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['locked', 'available', 'in_progress', 'completed', 'mastered'],
      default: 'available',
    },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    hintsUsed: { type: Number, required: true, default: 0, min: 0 },
    firstTry: { type: Boolean, required: true, default: false },
    bestAccuracy: { type: Number, required: true, default: 0, min: 0, max: 1 },
    completedAt: { type: Date, default: null },
    xpAwarded: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: '_challengeProgress' },
);

const progressSchema = defineSchema<ProgressDoc>(
  {
    userId: { type: String, required: true },
    moduleId: { type: String, required: true },
    levelId: { type: String, required: true },
    missionId: { type: String, required: true },
    status: { type: String, required: true, enum: MISSION_STATUSES, default: 'available' },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    challenges: { type: [challengeProgressSchema], default: [] },
    objectives: {
      type: [
        defineSchema<{ id: string; done: boolean; at: Date | null }>(
          {
            id: { type: String, required: true },
            done: { type: Boolean, required: true, default: false },
            at: { type: Date, default: null },
          },
          { collection: '_progressObjectives', timestamps: false },
        ),
      ],
      default: [],
    },
    durationMs: { type: Number, required: true, default: 0, min: 0 },
    hintsUsed: { type: Number, required: true, default: 0, min: 0 },
    flawless: { type: Boolean, required: true, default: true },
    score: { type: Number, required: true, default: 0, min: 0 },
    maxScore: { type: Number, required: true, default: 0, min: 0 },
    completedAt: { type: Date, default: null },
    xpAwarded: { type: Number, required: true, default: 0, min: 0 },
    lastAttemptId: { type: String, default: null },
    lastAttemptAt: { type: Date, default: null },
  },
  { collection: 'progress' },
);

// The dashboard's hot query: "all my progress in module X".
progressSchema.index({ userId: 1, moduleId: 1 });
// Leaderboards and per-level completion stats.
progressSchema.index({ missionId: 1, status: 1 });
progressSchema.index({ userId: 1, completedAt: -1 });
progressSchema.index({ userId: 1, levelId: 1, status: 1 });

export const ProgressModel = registerModel<ProgressDoc>('Progress', progressSchema);
