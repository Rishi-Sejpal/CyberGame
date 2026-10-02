import { describe, it, expect, vi } from 'vitest';
import { hash as argonHash } from '@node-rs/argon2';
import type * as EnvModule from '@/server/config/env';

/**
 * `needsRehash()` used to compare only memory cost and time cost, ignoring the
 * `p` (parallelism) parameter that is encoded in every stored hash. A hash
 * written with a lower parallelism is exactly as cheap to attack as one with a
 * lower memory cost, and the value is operator-controlled from the environment,
 * so it must participate in the comparison.
 *
 * The suite normally runs with `AUTH_TEST_FAST_HASH=true`, which pins
 * `parallelism` to 1 — the minimum, so a *weaker* stored hash cannot be built
 * against it. The policy is therefore stubbed here to require `p=2`, which makes
 * a `p=1` hash the interesting case while leaving the real hashing path alone.
 */
vi.mock('@/server/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    argon2Params: () => ({ algorithm: 2 as const, memoryCost: 1024, timeCost: 1, parallelism: 2 }),
  };
});

const { needsRehash } = await import('@/server/security/password');

const BASE = { algorithm: 2 as const, memoryCost: 1024, timeCost: 1 };

describe('needsRehash compares every encoded Argon2 parameter', () => {
  it('flags a hash whose parallelism is below the current policy', async () => {
    const weaker = await argonHash('Grid-Light-99!loop', { ...BASE, parallelism: 1 });
    expect(needsRehash(weaker)).toBe(true);
  });

  it('accepts a hash whose parameters exactly match the policy', async () => {
    const current = await argonHash('Grid-Light-99!loop', { ...BASE, parallelism: 2 });
    expect(needsRehash(current)).toBe(false);
  });

  it('does not flag a hash that is stronger than the policy on parallelism', async () => {
    const stronger = await argonHash('Grid-Light-99!loop', { ...BASE, parallelism: 4 });
    expect(needsRehash(stronger)).toBe(false);
  });

  it('still flags a weaker memory cost', async () => {
    // `timeCost` cannot go below the stubbed policy value of 1, so memory is the
    // only parameter where a *lower* stored value can be built here; it is
    // asserted so the parallelism check did not replace the existing ones.
    const lowMemory = await argonHash('x', { ...BASE, memoryCost: 512, parallelism: 2 });
    expect(needsRehash(lowMemory)).toBe(true);
  });

  it('flags a malformed or foreign hash outright', () => {
    expect(needsRehash('')).toBe(true);
    expect(needsRehash('not-a-hash')).toBe(true);
    expect(needsRehash('$argon2i$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')).toBe(true);
  });
});
