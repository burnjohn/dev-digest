import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, '../server/src/vendor/shared/index.ts'),
    },
  },
});
