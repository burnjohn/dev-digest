// ESLint 9 flat config — @devdigest/e2e.
//
// Two TypeScript files (run.ts, lib/assert.ts); the flows themselves are JSON,
// which ESLint does not read. So the rule that actually matters for this
// package — AGENTS.md's ban on the non-deterministic AI `chat` command — cannot
// live here. It is enforced by the `lint:flows` script instead, which greps
// specs/*.flow.json where that risk actually is.
//
// Style is Prettier's job; eslint-config-prettier is applied last.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  prettier,
);
