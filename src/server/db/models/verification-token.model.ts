import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * Single-use, purpose-scoped tokens: email verification and password reset.
 *
 * - `tokenHash` is a SHA-256 digest; the raw token only ever exists in the
 *   outbound email link.
 * - `purpose` is a discriminator so a verification link can never be replayed
 *   against the reset endpoint (and vice versa).
 * - The token is 256 bits of CSPRNG output, so it is not guessable and needs no
 *   attempt counter: a short numeric code would, but there is no code flow —
 *   verification is link-only. An earlier revision stored a `codeHash` plus
 *   `attemptsRemaining`/`maxAttempts` that nothing ever read or enforced; those
 *   fields only *looked* like brute-force protection, so they are gone rather
 *   than left to rot.
 * - Consumption is a single atomic `updateOne({ consumedAt: null })`, so a
 *   replayed token loses the race and fails.
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
    consumedAt: { type: Date, default: null },
    requestIp: { type: String, default: null, maxlength: 64 },
    expiresAt: { type: Date, required: true },
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
