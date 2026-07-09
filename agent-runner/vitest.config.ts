import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig.json path aliases — both packages are consumed as raw
      // TypeScript source, never as built artifacts.
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src/index.ts'),
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
