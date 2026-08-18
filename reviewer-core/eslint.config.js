// ESLint 9 flat config — @devdigest/reviewer-core.
//
// Purity is this package's contract (reviewer-core/AGENTS.md): no database, no
// GitHub, no filesystem. The only side effect is an LLM call through an
// INJECTED LLMProvider. That was true when audited, and this config is what
// keeps it true — previously nothing but review stood between the domain core
// and its first `import fs`.
//
// Style is Prettier's job; eslint-config-prettier is applied last.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Node built-ins, both bare and `node:`-prefixed. */
const IO_MODULES = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'net',
  'http',
  'https',
  'child_process',
  'crypto',
  'worker_threads',
].flatMap((m) => [m, `node:${m}`]);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // THE PURITY GATE. Anything needing I/O belongs in server/, not here.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...IO_MODULES.map((name) => ({
              name,
              message:
                'reviewer-core is the pure domain core — no filesystem, network or process I/O. Move this to server/ and pass the result in, or reach it through an injected port (reviewer-core/AGENTS.md).',
            })),
            {
              name: 'openai',
              message:
                'A concrete LLM SDK belongs in src/llm/, behind the injected LLMProvider port. Domain code calls input.llm.completeStructured(...) — see review/run.ts.',
            },
          ],
          patterns: [
            {
              group: ['drizzle-orm', 'postgres', 'octokit', '@octokit/*'],
              message:
                'reviewer-core has no database and no GitHub client. This belongs in server/.',
            },
            {
              group: ['../../server/**', '@devdigest/api'],
              message:
                'The domain core must not depend on the application that hosts it. Dependencies point inward only.',
            },
          ],
        },
      ],
    },
  },

  {
    // src/llm/ IS the adapter — it is allowed to hold the concrete SDK. This is
    // the one designated seam, and keeping the exemption this narrow is the
    // point: if a second directory ever needs it, that is a design change worth
    // arguing about, not a config tweak.
    files: ['src/llm/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-imports': 'off',
    },
  },

  prettier,
);
