import 'server-only';

import {
  hash as argonHash,
  verify as argonVerify,
  parseOptions as parseArgonOptions,
  type ParsedHashOptions,
} from '@node-rs/argon2';
import { env, argon2Params } from '@/server/config/env';
import { pepperedHash } from './crypto';

/**
 * Password hashing — Argon2id, always, with a keyed (peppered) variant.
 *
 * Design decisions
 * ----------------
 * - **Argon2id** is pinned (algorithm `2`). It is the only variant that is both
 *   GPU-resistant and side-channel resistant, which is what a shared web
 *   service needs.
 * - **Keyed hashing.** The configured `PASSWORD_PEPPER` is passed as Argon2's
 *   `secret` parameter, which makes it an HMAC-style key over *both* the
 *   password and the salt. A stolen `users` collection therefore cannot be
 *   attacked offline without also leaking the pepper from the environment — the
 *   two halves live in different trust boundaries.
 * - **Parameters travel inside the hash.** The encoded string carries `m`, `t`
 *   and `p`, so cost can be raised later without invalidating existing
 *   passwords. `needsRehash()` compares a stored hash against the current
 *   policy and `rehashIfNeeded()` transparently upgrades on next login.
 * - **Uniform failure.** A malformed stored hash reads as "wrong password"
 *   rather than a 500, so an attacker cannot use error shape as an oracle.
 *
 * The password *policy* is not defined here — it lives in the shared module so
 * the client-side strength meter and this server agree by construction.
 */

const PASSWORD_ALGORITHM = 2; // argon2id

/**
 * The policy itself now lives in `src/shared/password-policy.ts` so the browser
 * and this module cannot disagree about what a valid password is. Only the
 * hashing primitives remain here. Re-exported because callers already import
 * them from this path.
 */
export {
  PASSWORD_POLICY,
  checkPasswordPolicy,
  passwordIssueMessage,
} from '@/shared/password-policy';
export type { PasswordIssue, PasswordPolicyResult } from '@/shared/password-policy';

function pepperKey(): Buffer {
  return Buffer.from(env().PASSWORD_PEPPER, 'utf8');
}

export async function hashPassword(password: string): Promise<string> {
  const params = argon2Params();
  return argonHash(password, {
    algorithm: PASSWORD_ALGORITHM,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    secret: pepperKey(),
  });
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (!stored || typeof stored !== 'string') return false;
  try {
    return await argonVerify(stored, password, { secret: pepperKey() });
  } catch {
    // Malformed / foreign hash => "wrong password", never a distinguishable error.
    return false;
  }
}

/** Reads the parameters a stored hash was created with, or `null` if unparsable. */
export function inspectHash(stored: string): ParsedHashOptions | null {
  try {
    return parseArgonOptions(stored);
  } catch {
    return null;
  }
}

/** True when the stored hash used weaker parameters than we now require. */
export function needsRehash(stored: string): boolean {
  const target = argon2Params();
  const parsed = inspectHash(stored);
  if (!parsed) return true;
  if (parsed.algorithm !== PASSWORD_ALGORITHM) return true;
  return parsed.memoryCost < target.memoryCost || parsed.timeCost < target.timeCost;
}

export const PASSWORD_HASH_PREFIX = '$argon2id$';

/** True when the value looks like a hash *we* produced (defends log scrubbing). */
export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PASSWORD_HASH_PREFIX);
}

/** Deterministic, peppered handle for looking a user up by email. */
export function emailLookupHash(email: string): string {
  return pepperedHash(email.trim().toLowerCase(), 'email-lookup');
}
