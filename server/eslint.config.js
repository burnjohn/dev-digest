// ESLint 9 flat config — @devdigest/api.
//
// The point of this file is the dependency rule. `.claude/skills/onion-architecture`
// documents routes → service → repository and then admits: "there is no
// automated lint/CI gate enforcing these rules today ... catch it in review."
// This is that gate. Everything else here is small.
//
// Style is Prettier's job; eslint-config-prettier is applied last.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Drizzle and the schema module are infrastructure. Reaching for them from a
 * route or a service is the outer ring leaking inward — the query belongs in
 * that module's repository.ts.
 */
const NO_DRIZZLE = [
  'error',
  {
    paths: [
      {
        name: 'drizzle-orm',
        message:
          'Drizzle belongs in repository.ts / repository/*.repo.ts. Move the query there and call it from the service (onion-architecture skill, Dependency Rule #1).',
      },
    ],
    patterns: [
      {
        group: ['**/db/schema', '**/db/schema.js', '**/db/schema/**'],
        message:
          'Table definitions belong to the repository layer. Go through the module repository, or container.<x>Repo for another module (onion-architecture skill).',
      },
    ],
  },
];

export default tseslint.config(
  {
    // vendor/ is vendored; clones/ holds cloned user repos INCLUDING a full copy
    // of dev-digest itself — linting it would lint this repo twice (root CLAUDE.md).
    ignores: ['src/vendor/**', 'clones/**', 'dist/**', 'drizzle/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // A `!` is a claim tsc cannot check. server/src/modules/reviews/findings.ts
      // has two on a row that really can be undefined — a 500 where a 404 belongs.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // The dependency rule, enforced.
    files: ['src/modules/*/routes.ts', 'src/modules/*/service.ts'],
    rules: { 'no-restricted-imports': NO_DRIZZLE },
  },

  {
    // DOCUMENTED LEGACY EXCEPTION — do not "fix" these by refactoring.
    // pulls, polling, settings and workspace predate the routes/service/repository
    // split and query Drizzle straight from the handler. Both server/INSIGHTS.md
    // (2026-08-07) and the onion-architecture skill's "Known Exceptions" say to
    // leave them alone unless they are already being substantially rewritten.
    // Listing them here rather than loosening the rule keeps the exception
    // countable: this array should only ever get shorter.
    files: [
      'src/modules/pulls/**/*.ts',
      'src/modules/polling/**/*.ts',
      'src/modules/settings/**/*.ts',
      'src/modules/workspace/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    // reviewer-core is the domain core and must stay pure — no I/O, no DB, no
    // concrete provider. It is linted by its own config; this block only stops
    // the server from dragging infrastructure into it through a shared file.
    files: ['src/platform/structured.ts'],
    rules: { 'no-restricted-imports': NO_DRIZZLE },
  },

  {
    files: ['test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
