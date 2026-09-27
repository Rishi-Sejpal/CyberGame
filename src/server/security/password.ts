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
 */

const PASSWORD_ALGORITHM = 2; // argon2id

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 200,
  minLowercase: 1,
  minUppercase: 1,
  minDigits: 1,
  minSymbols: 1,
  /** Rejected outright: the credentials everybody tries first. */
  commonPasswords: new Set([
    'password',
    'password1',
    'password123',
    'passw0rd',
    '12345678',
    '123456789',
    '1234567890',
    'qwertyuiop',
    'letmein123',
    'iloveyou',
    'admin123',
    'administrator',
    'welcome123',
    'changeme',
    'trustno1',
    'monkey123',
    'dragon123',
    'football123',
    'baseball123',
    'superman123',
    'starwars123',
    'cyber123',
    'hackerman',
    'letmein',
    'football',
    'baseball',
    'shadow',
    'master',
    'dragon',
    'monkey',
    'abc123',
  ]),
} as const;

export interface PasswordPolicyResult {
  ok: boolean;
  /** Machine-readable reason codes; the UI maps these to friendly copy. */
  issues: string[];
}

/**
 * Pure policy check. Used by the register/reset endpoints AND by the client so
 * the two agree, but the server result is always authoritative.
 */
export function checkPasswordPolicy(
  password: string,
  context: { username?: string; email?: string } = {},
): PasswordPolicyResult {
  const issues: string[] = [];

  if (typeof password !== 'string' || password.length < PASSWORD_POLICY.minLength) {
    issues.push(`too_short_min_${PASSWORD_POLICY.minLength}`);
  }
  if (typeof password === 'string' && password.length > PASSWORD_POLICY.maxLength) {
    issues.push(`too_long_max_${PASSWORD_POLICY.maxLength}`);
  }

  const lower = (password ?? '').toLowerCase();
  if (PASSWORD_POLICY.commonPasswords.has(lower)) issues.push('too_common');

  const username = context.username?.trim();
  if (username && username.length >= 3 && lower.includes(username.toLowerCase())) {
    issues.push('contains_username');
  }
  if (context.email) {
    const local = context.email.split('@')[0] ?? '';
    if (local.length >= 3 && lower.includes(local.toLowerCase())) issues.push('contains_email');
  }

  const hasLower = /[a-z]/.test(password ?? '');
  const hasUpper = /[A-Z]/.test(password ?? '');
  const hasDigit = /\d/.test(password ?? '');
  const hasSymbol = /[^A-Za-z0-9]/.test(password ?? '');

  if (!hasLower) issues.push('needs_lowercase');
  if (!hasUpper) issues.push('needs_uppercase');
  if (!hasDigit) issues.push('needs_digit');
  if (!hasSymbol) issues.push('needs_symbol');

  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (classes < 3) issues.push('needs_three_classes');

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

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
