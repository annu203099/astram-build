import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Single root vitest config for the whole workspace.
 *
 * Key design decision: workspace packages are aliased to their TS SOURCE
 * (src/index.ts) so unit tests and e2e tests never require a prior
 * `pnpm build` of dependencies — parallel coding agents can verify their
 * package in isolation. Production runtime code uses compiled dist/ via
 * normal package exports (built topologically with `pnpm -r build`).
 *
 * RULE: only root-index imports are allowed (no subpath imports like
 * '@astram/gatekeeper/dist/...' in tests or source).
 */
const alias: Record<string, string> = {
  '@astram/types': r('./packages/shared-types/src/index.ts'),
  '@astram/db': r('./packages/db-ledger/src/index.ts'),
  '@astram/gatekeeper': r('./packages/gatekeeper/src/index.ts'),
  '@astram/mcp-proxy': r('./packages/mcp-proxy/src/index.ts'),
  '@astram/cordis-sandbox': r('./packages/cordis-sandbox/src/index.ts'),
  '@astram/turboquant': r('./packages/turboquant-worker/src/index.ts'),
  '@astram/canary': r('./packages/canary-healer/src/index.ts'),
  '@astram/server': r('./packages/server-daemon/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'testbed-attacks/src/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    watch: false,
    // Hard cap on parallel test workers. Timing-budget tests (TurboQuant
    // append/scan, Cordis fiber rollback, TEST-05) measure wall-clock
    // milliseconds; with one worker per core they contend for CPU and their
    // tails blow past the budgets nondeterministically. Two forks keep the
    // machine quiet enough for stable measurements (see ERROR_LOG.md).
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
