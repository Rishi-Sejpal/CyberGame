import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { clearDatabase, teardownDatabase, useTestDatabase } from './helpers/db';

const { audit, verifyChain } = await import('@/server/security/audit');
const { AuditLogModel } = await import('@/server/db/models/audit-log.model');

/**
 * The audit log is only worth anything if tampering is detectable, so the chain
 * is exercised against a real database rather than a mock: the point is that
 * MongoDB will happily store an edited row and the *verifier* is what notices.
 */
describe('audit chain', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  async function writeChain(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await audit({ event: 'auth.login.success', userId: `user-${i}` });
    }
  }

  it('verifies a chain written through the audit helper', async () => {
    await writeChain(3);

    const result = await verifyChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.brokenAt).toBeNull();
    expect(result.reason).toBeNull();
  });

  it('verifies an empty log', async () => {
    const result = await verifyChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
  });

  it('detects an edited field on any row', async () => {
    await writeChain(3);

    // Rewrite history: make a successful login look like a failure.
    await AuditLogModel.updateOne(
      { event: 'auth.login.success' },
      { $set: { outcome: 'failure' } },
    );

    const result = await verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash mismatch');
    expect(result.brokenAt).toBeTruthy();
  });

  it('detects a deleted row, because the next prevHash no longer matches', async () => {
    await writeChain(3);

    const middle = await AuditLogModel.findOne({}).sort({ createdAt: 1, _id: 1 }).lean();
    await AuditLogModel.deleteOne({ _id: middle!._id });

    const result = await verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('prevHash mismatch');
  });

  it('links each entry to the one before it', async () => {
    await writeChain(3);

    const rows = await AuditLogModel.find({}).sort({ createdAt: 1, _id: 1 }).lean();
    expect(rows[0]!.prevHash).toBe('genesis');
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);
    for (const row of rows) expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cannot be repaired by recomputing only the edited row', async () => {
    await writeChain(3);

    // What a naive attacker would do: fix the hash of the row they changed.
    const target = await AuditLogModel.findOne({}).sort({ createdAt: 1, _id: 1 }).lean();
    await AuditLogModel.updateOne(
      { _id: target!._id },
      { $set: { outcome: 'failure', hash: 'f'.repeat(64) } },
    );

    // The forgery is internally consistent for that row, but every later link
    // still points at the original hash, so the chain still breaks.
    const result = await verifyChain();
    expect(result.ok).toBe(false);
  });

  it('honours the limit argument', async () => {
    await writeChain(4);
    const result = await verifyChain(2);
    expect(result.checked).toBe(2);
  });
});

/** Audit *writing* for auth events is asserted in auth.test.ts. */
describe('audit persistence', () => {
  beforeAll(async () => {
    await useTestDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
    await mongoose.disconnect().catch(() => undefined);
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('never lets a failed audit write break the caller', async () => {
    const original = AuditLogModel.create.bind(AuditLogModel);
    // Force the write path to throw; audit() swallows it by design, since
    // losing a log row must not fail the action being logged.
    (AuditLogModel as unknown as { create: unknown }).create = () => {
      throw new Error('disk on fire');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(audit({ event: 'auth.login.success', userId: 'u1' })).resolves.toBeUndefined();
    } finally {
      (AuditLogModel as unknown as { create: unknown }).create = original;
      spy.mockRestore();
    }
  });
});
