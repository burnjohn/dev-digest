// Flat ESLint config for @devdigest/api.
//
// Beyond the usual TS hygiene this file carries the *layer-direction* rules the
// backend previously enforced by convention only (onion-architecture SOURCES
// §9.1/§9.6, §11). `dependency-cruiser` covers the graph-shaped rules that
// `no-restricted-imports` cannot express — see .dependency-cruiser.cjs.
//
// Type-aware linting is off on purpose: `pnpm typecheck` already runs tsc over
// the same files in CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "clones/**",
      // Canonical vendored contracts + generated migrations — see server/CLAUDE.md.
      "src/vendor/**",
      "src/db/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly" },
    },
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
    // Application services orchestrate through PORTS, never through concrete
    // port IMPLEMENTATIONS — the implementation is chosen in the composition
    // root (platform/container.ts) and reached as `container.<port>`.
    //
    // Scoped to the classes that implement a port, NOT to everything under
    // `adapters/`: `codeindex/extract.ts`, `astgrep/index.ts`, `git/diff-parser.ts`
    // and `llm/pricing.ts` export pure functions over strings (no IO, nothing
    // injected), so importing them directly inverts no dependency. They arguably
    // belong outside `adapters/` — moving them is a separate change.
    files: [
      "src/modules/**/service.ts",
      "src/modules/**/repository.ts",
      "src/modules/**/repository/*.ts",
      "src/modules/**/pipeline/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/adapters/secrets/*",
                "**/adapters/auth/*",
                "**/adapters/github/*",
                "**/adapters/git/simple-git*",
                "**/adapters/codeindex/ripgrep*",
                "**/adapters/llm/openai*",
                "**/adapters/llm/anthropic*",
                "**/adapters/embedder/*",
              ],
              message:
                "Services must depend on the port (interface), not its concrete implementation. Resolve it from the container (`container.github`, `container.llm(...)`, …) instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // Transport parses, resolves context, delegates and maps — it does not
    // query. The companion rule banning the SCHEMA import is in
    // .dependency-cruiser.cjs; this one covers the query builder itself, which
    // that graph cannot see (node_modules is excluded from it).
    files: ["src/modules/**/routes.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message:
                "Route handlers must not build queries. Move it into the module's repository.ts (or reach a shared one via the container) and call it from a service.",
            },
          ],
          patterns: [
            {
              group: ["drizzle-orm/*"],
              message:
                "Route handlers must not build queries. Move it into the module's repository.ts (or reach a shared one via the container) and call it from a service.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["*.mjs", "*.config.ts"],
    languageOptions: { globals: { process: "readonly", __dirname: "readonly" } },
  },
  {
    // `.dependency-cruiser.cjs` is CommonJS by extension — it needs `module`
    // in scope, which the ESM default parse does not provide.
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "writable", require: "readonly", __dirname: "readonly", process: "readonly" },
    },
  },
);
