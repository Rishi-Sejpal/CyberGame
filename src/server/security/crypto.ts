import 'server-only';

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { env } from '@/server/config/env';
import { timingSafeEqual } from './timing';

/**
 * Cryptographic primitives.
 *
 * Rules encoded here:
 *  - Anything used as a *secret* (session ids, email tokens) is 256 bits of
 *    CSPRNG output and is never derived from a guessable input.
 *  - Anything *derived from* a secret is stored as SHA-256 so a database dump
 *    cannot be replayed as a live session.
 *  - Comparison is constant time, always.
 */

const SECRET_BYTES = 32;

/** Raw, URL-safe secret suitable for handing to a client (cookie, email link). */
export function generateSecret(bytes = SECRET_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

/** One-time numeric code for email verification / 2FA style confirmations. */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const value = randomInt(0, max);
  return value.toString().padStart(digits, '0');
}

/** Deterministic, irreversible digest of a secret. Safe to store in Mongo. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Domain-separated peppered digest. Used for email lookups and for mixing the
 * configured pepper into password/token material so that a stolen database
 * alone is not enough to mount an offline attack.
 */
export function pepperedHash(value: string, purpose: string): string {
  return createHash('sha256')
    .update(`${purpose}\u0000${value}\u0000${env().PASSWORD_PEPPER}`, 'utf8')
    .digest('hex');
}

/** Short, non-secret fingerprint used in audit logs (e.g. "session a1b2…"). */
export function fingerprint(value: string): string {
  return hashToken(value).slice(0, 8);
}

/**
 * Delegates to the runtime-agnostic implementation so the Node handlers and the
 * edge middleware cannot drift apart on comparison behaviour.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(a, b);
}

export function randomIdempotencyKey(): string {
  return generateSecret(16);
}
