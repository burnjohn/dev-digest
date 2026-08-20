// Flat ESLint config for @devdigest/reviewer-core.
//
// The rule that matters here is `no-restricted-imports`: purity is this
// package's contract (see CLAUDE.md) — no DB, GitHub, filesystem, process.env
// or logging, with the injected LLMProvider as the only side effect. That was
// a prose promise; this makes it a build failure.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    // Purity gate — src/ only; tests may read fixtures from disk.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:fs", "node:fs/*", "fs", "fs/*",
                "node:child_process", "child_process",
                "drizzle-orm", "drizzle-orm/*",
                "postgres", "octokit", "simple-git", "fastify",
                "**/server/src/**",
              ],
              message:
                "reviewer-core is pure: no DB, GitHub, filesystem or framework imports. IO belongs in server/ — see reviewer-core/CLAUDE.md.",
            },
          ],
        },
      ],
      // `process.env` reads would make the engine environment-dependent.
      "no-restricted-globals": [
        "error",
        { name: "process", message: "reviewer-core must not read process.env — pass config in as an argument." },
      ],
    },
  },
  {
    files: ["*.mjs", "*.config.ts"],
    languageOptions: { globals: { process: "readonly", __dirname: "readonly" } },
  },
);
