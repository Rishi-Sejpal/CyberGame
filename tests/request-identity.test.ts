import { describe, it, expect, afterEach } from 'vitest';
import { clientIp, ipIdentity } from '@/server/security/request';

/**
 * Client-IP derivation is the input to every per-IP rate limit in the app, so a
 * client that can choose its own value can choose a fresh budget per request.
 *
 * The regression these tests lock down: `cf-connecting-ip` and `fly-client-ip`
 * used to be read *outside* the `TRUST_PROXY` guard. Sending a new
 * `cf-connecting-ip: <random>` on every request therefore handed an attacker an
 * unlimited supply of rate-limit buckets, defeating the login (10 / 15 min),
 * register (5 / hour) and forgot-password (3 / hour) limits without ever
 * authenticating.
 */

const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'fly-client-ip',
] as const;

/** TEST-NET-3 (RFC 5737) address space, so nothing here can be a real client. */
function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/login', { headers });
}

const originalTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  process.env.TRUST_PROXY = originalTrustProxy;
});

describe('clientIp: untrusted deployments', () => {
  it('ignores every proxy-supplied IP header when TRUST_PROXY is off', () => {
    process.env.TRUST_PROXY = '0';

    for (const header of PROXY_HEADERS) {
      expect(clientIp(req({ [header]: '203.0.113.9' })), `${header} was trusted`).toBeNull();
    }
  });

  it('ignores them for the string forms of TRUST_PROXY too', () => {
    for (const value of ['0', 'false', '', 'no', 'yes', '1 ']) {
      process.env.TRUST_PROXY = value;
      expect(
        clientIp(req({ 'cf-connecting-ip': '203.0.113.9' })),
        `TRUST_PROXY=${value}`,
      ).toBeNull();
    }
  });

  it('cannot be used to mint a fresh rate-limit identity per request', () => {
    process.env.TRUST_PROXY = '0';

    // The exploit itself: rotate the header, expect a different bucket each time.
    const identities = new Set(
      Array.from({ length: 50 }, (_unused, index) =>
        ipIdentity(req({ 'cf-connecting-ip': `203.0.113.${(index % 250) + 1}` })),
      ),
    );

    expect(identities.size).toBe(1);
    expect([...identities][0]).toBe('unknown');
  });

  it('collapses to the shared fail-closed bucket when no IP is available', () => {
    process.env.TRUST_PROXY = '0';
    expect(ipIdentity(req({}))).toBe('unknown');
    expect(ipIdentity(req({ 'user-agent': 'x' }))).toBe('unknown');
  });
});

describe('clientIp: TRUST_PROXY enabled', () => {
  it('honours the first x-forwarded-for hop only', () => {
    process.env.TRUST_PROXY = '1';

    // The edge writes the first entry; everything after it is client-supplied.
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.5, 198.51.100.7, 10.0.0.1' }))).toBe(
      '203.0.113.5',
    );
  });

  it('honours the edge headers the deployment actually declares', () => {
    process.env.TRUST_PROXY = '1';
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.22' }))).toBe('198.51.100.22');
    expect(clientIp(req({ 'fly-client-ip': '198.51.100.23' }))).toBe('198.51.100.23');
    expect(clientIp(req({ 'x-real-ip': '198.51.100.24' }))).toBe('198.51.100.24');
  });

  it('accepts a genuine IPv6 address', () => {
    process.env.TRUST_PROXY = '1';
    expect(clientIp(req({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});

describe('clientIp: malformed values', () => {
  it('rejects anything that is not shaped like an IP', () => {
    process.env.TRUST_PROXY = '1';

    const hostile = [
      'not-an-ip',
      '203.0.113.999', // out of range octet
      '203.0.113.5 evil-header: injected', // log-poisoning attempt
      '999.999.999.999',
      '',
      '   ',
      '203.0.113.5:80', // host:port is not an IP
    ];

    for (const value of hostile) {
      expect(clientIp(req({ 'x-forwarded-for': value })), value).toBeNull();
    }
  });

  it('never throws on a missing or absurd header', () => {
    process.env.TRUST_PROXY = '1';
    expect(() => clientIp(req({ 'x-forwarded-for': 'x'.repeat(10_000) }))).not.toThrow();
    expect(() => clientIp(req({}))).not.toThrow();
  });
});

describe('device labelling stays a function of the User-Agent only', () => {
  it('does not let a forged header change the derived OS/browser', async () => {
    process.env.TRUST_PROXY = '0';
    // Guard against a future refactor letting the IP path bleed into this one.
    const { deviceLabel } = await import('@/server/security/request');
    const label = deviceLabel(req({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' }));
    expect(label).toBe('Chrome on Windows');
  });
});
