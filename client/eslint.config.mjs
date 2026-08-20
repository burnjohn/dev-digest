// Flat ESLint config for @devdigest/web.
//
// The point of this file is the rules the codebase could not previously
// enforce: `react-hooks/exhaustive-deps` is an ERROR here, so the three
// historical `// eslint-disable-next-line` comments now suppress a rule that
// actually runs (see ../INSIGHTS.md, 2026-08-05).
//
// Type-aware linting is deliberately NOT enabled: `pnpm typecheck` already
// runs `tsc --noEmit` over the same files in CI, and the project-service pass
// roughly triples lint time for rules that mostly duplicate it.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    // `vendor/` is a vendored component kit + a hand-synced mirror of the
    // server's contracts — treat both as third-party (see client/CLAUDE.md).
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,

      // The rule this repo was missing. Error, not warn: a wrong dep list is
      // how stale closures ship.
      "react-hooks/exhaustive-deps": "error",

      // `_`-prefixed args are the established convention for deliberately
      // unused params (e.g. `onSuccess: (_d, repoId) => …`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      // Enforced by lint rather than by review; `verbatimModuleSyntax` is not
      // on, so nothing else catches a value-import of a type.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    // Tests legitimately reach for `any` when building partial fixtures.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Build-time config files run in Node, not the browser.
    files: ["*.mjs", "*.config.ts"],
    languageOptions: { globals: { process: "readonly", __dirname: "readonly" } },
  },
);
