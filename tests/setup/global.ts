/**
 * Global test setup: boots a throwaway MongoDB before the suite and tears it
 * down afterwards.
 *
 * We deliberately use the *locally installed* mongod binary
 * (`MONGOMS_SYSTEM_BINARY`) rather than downloading one, so the suite works
 * offline and in air-gapped CI images. The dbpath lives inside the repo's
 * gitignored `.tmp` folder, keeping the test run self-contained.
 */
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { existsSync } from 'node:fs';

const WORK_DIR = resolve(process.cwd(), '.tmp', 'mongo-test');
const URI_STORE = resolve(process.cwd(), '.tmp', 'mongo-test-uri');

declare global {
  var __CG_MONGO_URI__: string | undefined;
}

export default async function setup(): Promise<() => Promise<void>> {
  mkdirSync(WORK_DIR, { recursive: true });

  // Prefer a system mongod (no download, works offline). Fall back to whatever
  // mongodb-memory-server can provision itself.
  if (!process.env.MONGOMS_SYSTEM_BINARY) {
    for (const candidate of ['/usr/bin/mongod', '/usr/local/bin/mongod', '/opt/homebrew/bin/mongod']) {
      if (existsSync(candidate)) {
        process.env.MONGOMS_SYSTEM_BINARY = candidate;
        break;
      }
    }
  }

  const server = await MongoMemoryServer.create({
    instance: {
      dbName: 'cybergrid_test',
      dbPath: WORK_DIR,
      port: 27_019,
      storageEngine: 'wiredTiger',
    },
  });

  globalThis.__CG_MONGO_URI__ = server.getUri('cybergrid_test');

  const { writeFileSync } = await import('node:fs');
  writeFileSync(URI_STORE, globalThis.__CG_MONGO_URI__, 'utf8');

  return async () => {
    await server.stop({ doCleanup: true, force: true });
    try {
      rmSync(WORK_DIR, { recursive: true, force: true });
    } catch {
      // Windows/exFAT may hold a handle; the folder is gitignored either way.
    }
  };
}
