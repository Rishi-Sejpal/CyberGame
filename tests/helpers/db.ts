import 'server-only';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '@/server/db/connect';
import { env } from '@/server/config/env';

/**
 * Test database helpers.
 *
 * `useTestDatabase()` is idempotent per test file: it connects once, clears every
 * collection between tests, and disconnects on teardown. Content is re-seeded by
 * individual suites that need it, which keeps unrelated suites fast.
 */

const URI_FILE = resolve(process.cwd(), '.tmp', 'mongo-test-uri');

function readTestUri(): string {
  const fromEnv = process.env.__CG_MONGO_URI__ ?? globalThis.__CG_MONGO_URI__;
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(URI_FILE, 'utf8').trim();
  } catch {
    return env().TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27019/cybergrid_test';
  }
}

export async function useTestDatabase(): Promise<{ uri: string }> {
  const uri = readTestUri();
  process.env.MONGODB_URI = uri;
  process.env.TEST_MONGODB_URI = uri;
  await connectDb();
  return { uri };
}

export async function clearDatabase(): Promise<void> {
  await connectDb();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function teardownDatabase(): Promise<void> {
  await disconnectDb();
}

export function objectId(): string {
  return new mongoose.Types.ObjectId().toString();
}
