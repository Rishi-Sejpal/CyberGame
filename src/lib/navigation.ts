/**
 * Redirect-target safety.
 *
 * A `next` query parameter is attacker-controllable: anyone can send a victim a
 * link to `/login?next=…`. If the client then does `router.push(next)` on that
 * string, a successful sign-in hands the attacker a working open redirect, which
 * is the standard way to steal a session or launder a phishing page through a
 * domain the user trusts.
 *
 * The rules, applied in this order:
 *  1. Must be a string (query params arrive as `string | string[]`).
 *  2. Must start with a single `/`.
 *  3. Must not start with `//` or `/\` — those are protocol-relative URLs, so
 *     `//evil.example` would navigate off-site while looking like a path.
 *  4. Must not contain a backslash anywhere, since several browsers normalise
 *     `\` to `/` and would turn `/\evil.example` back into a protocol-relative
 *     URL after the check.
 *  5. Contains no control characters, which some proxies treat as a header
 *     terminator and which can truncate a `Location` value.
 *  6. Is capped in length.
 *
 * Same-origin paths only. If the caller wants to go somewhere else, they type it
 * in, which means they can see where they are going.
 */

const MAX_NEXT_LENGTH = 200;

function hasControlCharacter(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export const DEFAULT_REDIRECT_AFTER_LOGIN = '/dashboard';

export function sanitizeNextPath(value: string | string[] | undefined | null): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return DEFAULT_REDIRECT_AFTER_LOGIN;

  const candidate = raw.trim();
  if (!candidate || candidate.length > MAX_NEXT_LENGTH) return DEFAULT_REDIRECT_AFTER_LOGIN;
  if (!candidate.startsWith('/')) return DEFAULT_REDIRECT_AFTER_LOGIN;
  if (candidate.startsWith('//') || candidate.startsWith('/\\'))
    return DEFAULT_REDIRECT_AFTER_LOGIN;
  if (candidate.includes('\\') || candidate.includes('\n') || candidate.includes('\r')) {
    return DEFAULT_REDIRECT_AFTER_LOGIN;
  }
  // Control characters can truncate the Location header in some proxies, and a
  // raw newline is a response-splitting primitive if it ever reached a header.
  if (hasControlCharacter(candidate)) return DEFAULT_REDIRECT_AFTER_LOGIN;

  return candidate;
}
