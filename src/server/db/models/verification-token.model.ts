import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * Single-use, purpose-scoped tokens: email verification and password reset.
 *
 * - `tokenHash` is a SHA-256 digest; the raw token only ever exists in the
 *   outbound email link.
 * - `purpose` is a discriminator so a verification link can never be replayed
 *   against the reset endpoint (and vice versa).
 * - `attemptCount` allows limited brute-forcing of the short numeric code path
 *   without a separate rate-limit collection.
 * - Mongo TTL removes the row `expiresAt` seconds after expiry, so there is no
 *   cleanup job to forget.
 */

export const TOKEN_PURPOSES = ['email_verification', 'password_reset'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export interface VerificationTokenDoc {
  _id: unknown;
  userId: string;
  purpose: TokenPurpose;
  tokenHash: string;
  /** Numeric one-time code, stored hashed. Null for link-only flows. */
  codeHash: string | null;
  attemptsRemaining: number;
  maxAttempts: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  requestIp: string | null;
}

const tokenSchema = defineSchema<VerificationTokenDoc>(
  {
    userId: { type: String, required: true, index: true },
    purpose: { type: String, required: true, enum: TOKEN_PURPOSES },
    tokenHash: { type: String, required: true, unique: true },
    codeHash: { type: String, default: null },
    attemptsRemaining: { type: Number, required: true, default: 5, min: 0 },
    maxAttempts: { type: Number, required: true, default: 5, min: 1 },
    consumedAt: { type: Date, default: null },
    requestIp: { type: String, default: null, maxlength: 64 },
  },
  { collection: 'verificationTokens', timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

// "resend link" replaces any outstanding token for the same purpose.
tokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const VerificationTokenModel = registerModel<VerificationTokenDoc>(
  'VerificationToken',
  tokenSchema,
);
