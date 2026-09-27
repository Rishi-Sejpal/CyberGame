/**
 * Identity field rules, shared by the server schemas and the browser forms.
 *
 * These regexes are the ones the Zod schemas validate with. Keeping a single
 * definition means "3-20 lowercase letters, digits, _ and -" is stated once, so
 * a form cannot accept a callsign the server will reject — or reject one it
 * would have allowed.
 *
 * No imports: this file is pulled into both the Node and browser bundles.
 */

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,18})[a-z0-9]$/;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const EMAIL_MAX = 254;

/**
 * Handles that would impersonate the application itself or a staff account.
 *
 * Stored already lower-cased, because that is the only form usernames are ever
 * compared in. Callers must go through `isReservedUsername` rather than probing
 * the set directly: `RESERVED_USERNAMES.has('Admin')` is `false`, which is a
 * footgun that reads as a pass.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'staff',
  'mod',
  'moderator',
  'cybergrid',
  'vera',
  'null',
  'undefined',
  'anonymous',
  'official',
]);

/** Case- and whitespace-insensitive reserved-handle check. */
export function isReservedUsername(value: string): boolean {
  if (typeof value !== 'string') return false;
  return RESERVED_USERNAMES.has(value.trim().toLowerCase());
}

export function usernameLengthError(length: number): string | undefined {
  if (length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters.`;
  return undefined;
}
