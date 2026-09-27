import 'server-only';

import { defineSchema, registerModel } from '../model-kit';

/**
 * `users` — the identity record only.
 *
 * Splitting identity from `profiles` (game state) and `progress` (per-mission
 * records) keeps the two access patterns on separate collections: session
 * validation hits `users` by id on every request, while the dashboard only
 * needs `progress`.
 *
 * Nothing sensitive beyond the password hash is stored. No IPs, no
 * user-agent strings, no reset tokens — those live in purpose-built
 * collections with their own TTLs.
 */

export const USER_ROLES = ['player', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['pending_verification', 'active', 'suspended', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserDoc {
  _id: unknown;
  username: string;
  usernameLower: string;
  displayName: string;
  email: string;
  emailLookupHash: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  /** Brute-force throttling, persisted so it survives a restart. */
  failedLoginCount: number;
  failedLoginWindowStart: Date | null;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastLoginIp: string | null;
  passwordChangedAt: Date;
  /** Bumped on password reset / forced logout; older sessions are rejected. */
  sessionEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = defineSchema<UserDoc>(
  {
    username: { type: String, required: true, minlength: 3, maxlength: 20 },
    // Unique, case-insensitive index. Also the cheap first-pass existence check.
    usernameLower: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, minlength: 1, maxlength: 32 },
    email: { type: String, required: true, maxlength: 254 },
    // Peppered digest: enables a unique index on email without storing a
    // searchable plaintext address in an index that could leak via the log.
    emailLookupHash: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: USER_ROLES, default: 'player', index: true },
    status: { type: String, required: true, enum: USER_STATUSES, default: 'pending_verification' },
    emailVerified: { type: Boolean, required: true, default: false },
    emailVerifiedAt: { type: Date, default: null },
    failedLoginCount: { type: Number, required: true, default: 0, min: 0 },
    failedLoginWindowStart: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, maxlength: 64 },
    passwordChangedAt: { type: Date, required: true, default: () => new Date() },
    sessionEpoch: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'users' },
);

// Reporting / moderation queries: "newest unverified accounts", "suspended users".
userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ emailVerified: 1, createdAt: -1 });

export const UserModel = registerModel<UserDoc>('User', userSchema);
