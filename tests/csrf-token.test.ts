import { describe, expect, it } from 'vitest';
import {
  bytesToBase64Url,
  generateCsrfToken,
  isWellFormedCsrfToken,
} from '@/server/security/csrf-token';
import { timingSafeEqual } from '@/server/security/timing';

/**
 * The edge CSRF path.
 *
 * This module runs in middleware, where a mistake is invisible: the first person
 * to notice is a brand-new visitor whose login form silently fails, because the
 * cookie the form reads was never issued. The base64url encoder is hand-rolled
 * (no `btoa` on the edge, no `Buffer` either), so it is checked against the RFC
 * 4648 test vectors rather than trusted.
 */
describe('base64url encoding', () => {
  const vectors: Array<[number[], string]> = [
    [[], ''],
    [[0x66], 'Zg'],
    [[0x66, 0x6f], 'Zm8'],
    [[0x66, 0x6f, 0x6f], 'Zm9v'],
    [[0x66, 0x6f, 0x6f, 0x62], 'Zm9vYg'],
    [[0x66, 0x6f, 0x6f, 0x62, 0x61], 'Zm9vYmE'],
    [[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], 'Zm9vYmFy'],
  ];

  it('matches the RFC 4648 vectors for "foo"/"bar"', () => {
    for (const [bytes, expected] of vectors) {
      expect(bytesToBase64Url(Uint8Array.from(bytes))).toBe(expected);
    }
  });

  it('encodes a full 32-byte block as 43 characters with no padding', () => {
    const encoded = bytesToBase64Url(new Uint8Array(32));
    expect(encoded).toHaveLength(43);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('round-trips the high-bit bytes that break a naive Latin-1 encoder', () => {
    // 0xFF and 0xFE are not valid single-byte text; this is the case that would
    // throw inside btoa on the edge.
    const bytes = Uint8Array.from([0xff, 0xfe, 0xfd, 0x80, 0x00, 0x7f]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).toHaveLength(8);
    expect(Buffer.from(encoded, 'base64url').equals(Buffer.from(bytes))).toBe(true);
  });

  it('agrees with Node for every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    expect(bytesToBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
  });
});

describe('CSRF token shape', () => {
  it('issues a well-formed 43-character token', () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(43);
    expect(isWellFormedCsrfToken(token)).toBe(true);
  });

  it('issues a different token every time', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateCsrfToken()));
    // 200 draws from 2^256 colliding is not a real possibility, so a repeat here
    // means the randomness is broken, which is worth failing loudly over.
    expect(tokens.size).toBe(200);
  });

  it('rejects a token that is not exactly 32 bytes of base64url', () => {
    for (const value of [
      null,
      undefined,
      '',
      'short',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}/`,
    ]) {
      expect(isWellFormedCsrfToken(value)).toBe(false);
    }
  });

  it('accepts a real token as its own comparison partner', () => {
    const token = generateCsrfToken();
    expect(timingSafeEqual(token, token)).toBe(true);
    expect(timingSafeEqual(token, generateCsrfToken())).toBe(false);
  });
});
