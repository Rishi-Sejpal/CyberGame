/**
 * Edge-compatible CSRF token issuing.
 *
 * The middleware must hand a browser a CSRF cookie before it can submit
 * anything, including the login form for a visitor who has no session yet. That
 * has to happen in the middleware because a Server Component cannot set cookies
 * and a Server Action would force an extra round trip on every page view.
 *
 * The edge runtime has no `node:crypto`, so this module uses Web Crypto
 * (`crypto.getRandomValues`), which is available in both runtimes. 256 bits of
 * CSPRNG output, base64url-encoded, is exactly as strong as the Node path.
 */

const CSRF_TOKEN_BYTES = 32;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Base64url without `btoa` or `Buffer`.
 *
 * Hand-rolled rather than delegated to `btoa` because `btoa` rejects characters
 * outside Latin-1 and we are encoding raw bytes, not text.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64URL_ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64URL_ALPHABET[b2 & 0b111111];
  }
  return out;
}

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** A token we issued is 32 bytes → 43 base64url characters. */
export function isWellFormedCsrfToken(value: string | null | undefined): boolean {
  if (!value) return false;
  if (value.length !== 43) return false;
  for (const ch of value) {
    if (!BASE64URL_ALPHABET.includes(ch)) return false;
  }
  return true;
}
