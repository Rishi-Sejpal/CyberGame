import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { useTestDatabase, clearDatabase, teardownDatabase } from './helpers/db';
import { env } from '@/server/config/env';
import { hashPassword, verifyPassword, checkPasswordPolicy } from '@/server/security/password';

describe('foundation smoke', () => {
  beforeAll(async () => { await useTestDatabase(); });
  afterAll(async () => { await teardownDatabase(); });

  it('boots with a valid environment', () => {
    expect(env().NODE_ENV).toBe('test');
    expect(env().SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('round-trips argon2id hashes', async () => {
    const hash = await hashPassword('Correct-Horse-9!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'Correct-Horse-9!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('enforces the password policy', () => {
    expect(checkPasswordPolicy('short').ok).toBe(false);
    expect(checkPasswordPolicy('AllLowercase1!aaaa').ok).toBe(true);
    expect(checkPasswordPolicy('NoDigits!AAAAaaa').ok).toBe(false);
  });

  it('connects to the test database and can clear it', async () => {
    await clearDatabase();
    expect(true).toBe(true);
  });
});
