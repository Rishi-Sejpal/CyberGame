import 'server-only';

import mongoose from 'mongoose';
import { env, mongodbUri } from '@/server/config/env';

/**
 * MongoDB connection management.
 *
 * Design notes
 * ------------
 * - A single global connection is cached on `globalThis` so Next's dev-mode
 *   hot reload does not leak connection pools.
 * - The returned `connect()` is idempotent and safe to await from anywhere.
 * - Retry/backoff is delegated to the driver via `serverSelectionTimeoutMS`,
 *   because a route handler that hangs for 30s is worse than a 500.
 * - `trustProxy` is intentionally left OFF: the app must never derive the
 *   client IP from a spoofable header unless the operator opts in explicitly.
 */

declare global {
  var __cybergridMongoose: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const globalCache = (globalThis as typeof globalThis).__cybergridMongoose ?? {
  conn: null as typeof mongoose | null,
  promise: null as Promise<typeof mongoose> | null,
};
(globalThis as typeof globalThis).__cybergridMongoose = globalCache;

export async function connectDb(): Promise<typeof mongoose> {
  if (globalCache.conn) return globalCache.conn;

  globalCache.promise ??= mongoose
    .connect(mongodbUri(), {
      // Fail fast instead of hanging a request when the primary is unreachable.
      serverSelectionTimeoutMS: 8_000,
      connectTimeoutMS: 8_000,
      maxPoolSize: 20,
      minPoolSize: env().NODE_ENV === 'production' ? 2 : 0,
      // Never let a stray query string in MONGODB_URI weaken auth defaults.
      autoIndex: env().NODE_ENV !== 'production',
    })
    .then((m) => {
      globalCache.conn = m;
      return m;
    });

  try {
    return await globalCache.promise;
  } catch (error) {
    globalCache.promise = null;
    throw error;
  }
}

/**
 * Index creation strategy:
 *  - development/test: mongoose `autoIndex` builds them in the background.
 *  - production: an explicit deployment step (`npm run db:indexes`) so a large
 *    catalog never blocks the first request while indexes build.
 */
export function db(): mongoose.Connection {
  if (!globalCache.conn) {
    throw new Error('Database not connected. Call connectDb() first.');
  }
  return globalCache.conn.connection;
}

export async function disconnectDb(): Promise<void> {
  if (globalCache.promise) {
    await globalCache.promise.catch(() => undefined);
    globalCache.promise = null;
  }
  if (globalCache.conn) {
    await globalCache.conn.disconnect();
    globalCache.conn = null;
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
