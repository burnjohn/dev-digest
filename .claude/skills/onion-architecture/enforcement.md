# Enforcement — the dependency-cruiser gate

This is what turns the dependency rule from "remember to" into "the build fails otherwise."
`dependency-cruiser` is **already** in `server/package.json` (today used only as the
`adapters/depgraph` implementation), so there is nothing new to install.

`dependency-cruiser` is a "test runner for your import graph": you declare `forbidden` rules
over `from → to` path patterns and it reports every edge that violates them. RE2-based — so
**no regex look-ahead**; exclusions are expressed with `pathNot`, and the `$1` back-reference
in `to.path` refers to the capture group in `from.path`.

## 1. Add the config — `server/.dependency-cruiser.cjs`

> CommonJS (`.cjs`) on purpose: `server` is `"type": "module"`, so a plain `.js` config would
> be parsed as ESM.

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Cycles break the inward-only rule. WARN today: most cycles run through the DI ' +
        'composition root (container ↔ service) — a tradeoff of the "service takes Container" ' +
        'style; plus one genuine same-module cycle agents/helpers ↔ agents/repository to fix.',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-is-pure',
      comment:
        'reviewer-core is the domain core: NO I/O. Only the injected LLMProvider. ' +
        'The same code runs in the server and in CI.',
      severity: 'error',
      from: { path: 'reviewer-core/src' },
      to: {
        path: [
          '^fastify', 'drizzle-orm', '^postgres', 'octokit', 'simple-git',
          '@ast-grep/napi', '/src/adapters/', '/src/db/', '^node:fs',
        ],
      },
    },
    {
      name: 'services-depend-on-ports',
      comment:
        'A feature service orchestrates through ports (via container.*), never a concrete ' +
        'adapter SDK wrapper. Exception: repo-intel IS the indexer subsystem (infrastructure).',
      severity: 'error',
      from: {
        path: 'src/modules/[^/]+/(service|run-executor)[^/]*\\.ts$',
        pathNot: 'src/modules/repo-intel/',
      },
      to: { path: 'src/adapters/' },
    },
    {
      name: 'routes-are-thin',
      comment: 'Transport (routes) calls the service; it never reaches into adapters.',
      severity: 'error',
      from: { path: 'src/modules/[^/]+/routes\\.ts$' },
      to: { path: 'src/adapters/' },
    },
    {
      name: 'db-confined-to-repositories',
      comment:
        'Drizzle/db schema queries belong in modules/*/repository*. DRIFT (warn): 8 files ' +
        'query db/schema outside a repository (routes of polling/pulls/workspace/settings, ' +
        'plus reviews/run-executor, reviews/diff-loader, repos/helpers, settings/feature-models).',
      severity: 'warn',
      from: { path: 'src/modules/', pathNot: 'src/modules/[^/]+/repository' },
      to: { path: ['src/db/schema', '^drizzle-orm'] },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        'One feature reaches another only through container.* (the composition root), never ' +
        'by importing its sibling module folder. _shared is the allowed common ground. WARN ' +
        'today: pulls/routes → reviews/helpers, and repos/service → repo-intel/constants.',
      severity: 'warn',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: ['^src/modules/$1/', '^src/modules/_shared/'] },
    },
    {
      name: 'adapters-dont-know-modules',
      comment:
        'Infrastructure must not depend on a feature. ' +
        'Exception: adapters/depgraph reads repo-intel/constants — move those constants out to remove it.',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/repo-intel/constants' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['node_modules', '/dist/', '\\.test\\.ts$', '\\.it\\.test\\.ts$'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
```

## 2. Add the scripts — `server/package.json`

```jsonc
{
  "scripts": {
    // server tree only (fast; reviewer-core still gets checked where server imports it)
    "depcruise": "depcruise src --config .dependency-cruiser.cjs",
    // full coverage incl. reviewer-core as a first-class root (run before release / in CI)
    "depcruise:all": "depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs"
  }
}
```

## 3. Run it

```bash
cd server
npm run depcruise        # baseline today: 0 errors, 15 warnings
npm run depcruise:all    # also walks reviewer-core as a root for the core-is-pure rule
```

dependency-cruiser exits non-zero only on an **`error`**; warnings report without failing. So
the gate is green today and **blocks any new `error`**. Wire `npm run depcruise` into CI next
to typecheck/tests; optionally add a pre-commit hook so bad edges never land.

## Severity rationale — adopt as a ratchet, not a big-bang

This was validated against the real graph (`125 modules, 376 dependencies`). The strict rules
that the codebase **already** satisfies are `error`; the rules with genuine existing
violations start at `warn` (a burn-down baseline) so the gate is adoptable immediately, then
get promoted to `error` as each backlog is cleared.

- **`error` (clean today — keep them blocking):** `core-is-pure`, `services-depend-on-ports`,
  `routes-are-thin`, `adapters-dont-know-modules`. A new violation here fails CI.
- **`warn` (real drift, burn down then promote):**
  - `db-confined-to-repositories` — **8** files query `db/schema` outside a repository.
    Promote to `error` once each is moved into a `repository`.
  - `no-cross-module-internals` — **2** edges: `pulls/routes.ts → reviews/helpers.ts`
    (move the shared `findingRowToDto` mapper into `_shared`) and
    `repos/service.ts → repo-intel/constants.ts` (relocate the shared constant). Promote after.
  - `no-circular` — cycles via `platform/container.ts` (the "service takes `Container`" DI
    style) plus one genuine same-module cycle `agents/helpers ↔ agents/repository`. Fix the
    agents cycle; then decide a container-cycle policy (e.g. inject only the needed ports, or
    `exclude` the composition root from circular detection) before promoting.

## Known exceptions encoded (and how to retire them)

| Exception | Why it exists | Clean fix |
|-----------|---------------|-----------|
| `repo-intel/service` may import adapters (`pathNot` on `services-depend-on-ports`) | repo-intel is the indexer subsystem, reached via the `container.repoIntel` facade — it *is* infrastructure | none needed; keep the facade boundary intact |
| `adapters/depgraph` → `repo-intel/constants` (`pathNot` on `adapters-dont-know-modules`) | shares `SUPPORTED_EXT` | move the shared constant to `platform/` or `_shared`, then delete the `pathNot` |

When you remove an exception (or burn down a `warn` backlog) in code, tighten the config in the
same change — an exception or lenient severity that outlives its cause silently re-opens the
boundary. That tightening *is* the ratchet.

## Validating the config itself

After editing rules, sanity-check that they parse and that the exception scoping is right:

```bash
cd server
npx depcruise src --config .dependency-cruiser.cjs --output-type err-long   # readable violation report
npx depcruise src --config .dependency-cruiser.cjs --output-type dot | dot -T svg > graph.svg  # visualize
```
