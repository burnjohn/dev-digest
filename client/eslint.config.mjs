// ESLint 9 flat config — @devdigest/web.
//
// Deliberately small. Every rule here exists because an audit found the defect
// already in the tree, not because a preset ships it. Style is Prettier's job;
// eslint-config-prettier is applied last to keep the two from arguing.
//
// Not type-checked linting (no parserOptions.project): every rule below works
// off syntax alone, and the typed variant would double the CI time for nothing.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // vendor/ is vendored (root CLAUDE.md: do not touch). .next is build output.
    ignores: ['src/vendor/**', '.next/**', 'next-env.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Root-level config files (next.config.mjs, postcss, vitest) run in Node,
    // not the browser. Without this they fall through to js.configs.recommended
    // with no globals declared, and `process` reads as no-undef.
    files: ['*.{js,mjs,ts}'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly', URL: 'readonly' },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // F13 — 18 `<div onClick>` with no role, tabIndex or key handler. The
      // correct shape already exists in the tree at FindingsCell.tsx:133-142.
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',

      // F5 — a non-null assertion is a claim the type system can't check.
      '@typescript-eslint/no-non-null-assertion': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // F14 — `export *` defeats Next's cross-boundary tree-shaking, and a barrel
    // that wildcards client hooks into a server import path can fail the build
    // outright (client/INSIGHTS.md 2026-08-07). Named re-exports are fine.
    files: ['src/**/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message:
            "`export *` in a barrel breaks tree-shaking across the RSC boundary. Re-export by name instead — see client/INSIGHTS.md.",
        },
      ],
    },
  },

  {
    // frontend-ui-architecture §8 — code flows one way: shared → features → app.
    // A feature reaching sideways into another feature's _components is how
    // feature folders rot; compose at the app level instead.
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/../*/_components/**'],
              message:
                'Cross-feature import. Promote the shared piece to src/components/ (promotion rule) or compose at the page level.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
