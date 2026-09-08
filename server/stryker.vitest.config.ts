import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * A narrowed copy of vitest.config.ts, used only by Stryker (stryker.config.json).
 * Stryker's vitest-runner re-runs the configured test file per mutant — scoping
 * `include` to just scoring.test.ts (instead of the full ~745-test suite) is what
 * keeps a mutation run on this one module minutes, not hours. Same aliases as the
 * real config, since scoring.ts imports types through them.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/modules/eval/scoring.test.ts'],
  },
});
