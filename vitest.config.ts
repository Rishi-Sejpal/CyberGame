import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/env.ts'],
    globalSetup: ['tests/setup/global.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/server/**', 'src/lib/**', 'src/game/systems/**'],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
  },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${r('./src')}/$1` },
      // `server-only` intentionally throws outside a React Server graph. In the
      // Node test environment every module is server-side, so stub it out.
      { find: /^server-only$/, replacement: r('./tests/stubs/server-only.ts') },
    ],
  },
});
