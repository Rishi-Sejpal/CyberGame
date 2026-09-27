import 'server-only';

import mongoose, { Schema, type SchemaDefinitionProperty, type Model } from 'mongoose';

/**
 * Model conventions enforced across the whole database layer.
 *
 * Keeping these in one place means a reviewer can be confident that every
 * collection:
 *  - uses UTC dates,
 *  - never stores unknown fields (`strict: 'throw'` blocks mass assignment of
 *    `role`, `xp`, `level`, ... from a request body),
 *  - and registers exactly once despite Next.js dev hot-reload.
 */

/** Fields that must never be writable through a request body. */
export const SERVER_ONLY_FIELDS = [
  'role',
  'status',
  'xp',
  'level',
  'emailVerified',
  'emailVerifiedAt',
  'passwordResetCount',
  'lastLoginAt',
  'failedLoginCount',
  'lockedUntil',
] as const;

export interface BaseDocumentOptions {
  collection: string;
  versionKey?: boolean;
  /** `true` for createdAt/updatedAt, or an explicit mongoose mapping. */
  timestamps?: boolean | { createdAt: string; updatedAt: string | false };
}

export function defineSchema<T>(
  definition: Record<string, SchemaDefinitionProperty>,
  options: BaseDocumentOptions,
): Schema<T> {
  return new Schema<T>(definition, {
    collection: options.collection,
    strict: 'throw',
    strictQuery: true,
    versionKey: options.versionKey === true ? '__v' : false,
    timestamps: options.timestamps ?? true,
    autoCreate: true,
    minimize: false,
  });
}

/**
 * Registers a model exactly once. Without this, `next dev` re-evaluating the
 * module graph throws `OverwriteModelError`.
 */
export function registerModel<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  if (existing) return existing;
  return mongoose.model<T>(name, schema);
}
