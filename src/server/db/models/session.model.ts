import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `sessions` — server-side session store.
 *
 * The cookie carries a random 256-bit `token`. Only its SHA-256 digest is
 * stored, so a database read cannot be turned into a live session.
 *
 * `sessionEpoch` is denormalised onto the session: bumping `users.sessionEpoch`
 * (on password reset or "log out everywhere") instantly invalidates every
 * session that was minted under the previous value, with a single indexed
 * comparison per request and no need to sweep documents.
 */

export interface SessionDoc {
  _id: unknown;
  /** SHA-256 of the cookie token. Indexed unique — this is the lookup key. */
  tokenHash: string;
  userId: string;
  /** Copied from `users.sessionEpoch` at creation time. */
  sessionEpoch: number;
  /** Short, non-secret label so a player can recognise their own device. */
  label: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Sliding refresh horizon. */
  expiresAt: Date;
  /** Hard ceiling that sliding refresh can never extend past. */
  absoluteExpiresAt: Date;
  /** Rotated in place when the password changes or the user revokes it. */
  revokedAt: Date | null;
  revokedReason: string | null;
  ip: string | null;
  userAgent: string | null;
}

const sessionSchema = defineSchema<SessionDoc>(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    sessionEpoch: { type: Number, required: true, min: 1 },
    label: { type: String, required: true, default: 'unknown device', maxlength: 80 },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null, maxlength: 64 },
    ip: { type: String, default: null, maxlength: 64 },
    userAgent: { type: String, default: null, maxlength: 400 },
  },
  { collection: 'sessions', timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

// Revoke-all-devices for one user.
sessionSchema.index({ userId: 1, revokedAt: 1 });
// Housekeeping sweep of expired/revoked rows.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
sessionSchema.index({ userId: 1, lastSeenAt: -1 });

export const SessionModel = registerModel<SessionDoc>('Session', sessionSchema);
