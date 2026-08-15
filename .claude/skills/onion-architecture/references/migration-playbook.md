# Migration playbook — the nine violations, cheapest first

Every violation below was re-confirmed by grep against the tree on **2026-08-15**; file:line
references are from that run. Ordered by cost, so the list can be worked top-down and each step
lands independently.

**Rule for the whole playbook: migrate one module end-to-end at a time.** A half-migrated module is
worse than an unmigrated one — the reader can no longer tell which convention is in force.

| Step | Violation | Effort | Files touched |
|---|---|---|---|
| 1 | V6 — cross-module job-kind constants | ~10 min | 3 |
| 2 | V8 — adapters importing a feature module | ~15 min | 3 |
| 3 | V9 — adapter importing a tool | ~10 min | 3 |
| 4 | `platform/infra/` move + shim deletion | ~30 min | 12 |
| 5 | V3 — type leaks → `db/rows.ts` | ~15 min | 4 |
| 6 | V7 — `Parameters<>` over re-declared types | ~45 min | 1 |
| 7 | V1 — `Deps` per module | ~30 min **per module** | 9 |
| 8 | V2 — `pulls` / `settings` extraction | ~1 day | 2 modules |

---

## Step 1 — V6: hoist the job kinds

**Found:** `src/modules/repos/service.ts:12-14` imports `INDEX_JOB_KIND`, `REFRESH_JOB_KIND` from
`../repo-intel/constants.js`.

A job kind is a contract *between* modules — the enqueuer and the handler are in different modules
by definition. It cannot live inside either one.

Create `src/platform/job-kinds.ts`:

```ts
/**
 * Job kinds are contracts BETWEEN modules — the enqueuer and the handler never
 * live in the same module — so they belong to the kernel, not to either side.
 */
export const CLONE_JOB_KIND = 'clone';
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
export const RESYNC_JOB_KIND = 'repo-intel-resync';
```

Then: delete the four constants from `modules/repo-intel/constants.js` and `CLONE_JOB_KIND` from
`modules/repos/constants.js`; point every importer at `platform/job-kinds.js`.

```bash
grep -rn "INDEX_JOB_KIND\|REFRESH_JOB_KIND\|RESYNC_JOB_KIND\|CLONE_JOB_KIND" src test
```

**Verify:** the cross-module grep returns zero.

```bash
grep -rn "from '\.\./[a-z-]*/" src/modules/*/*.ts | grep -v "_shared\|\.\./\.\."
```

---

## Step 2 — V8: make the adapters feature-agnostic

**Found:**
- `src/adapters/astgrep/index.ts:25` → `MAX_SIGNATURE_CHARS`, `SUPPORTED_EXT`
- `src/adapters/depgraph/index.ts:20` → `SUPPORTED_EXT`

Pure onion permits outer→inner, so "an adapter importing a module" is not caught by the ring rule
alone. The sharper rule is the one in SKILL §5: **driven adapters are feature-agnostic.** An
adapter that knows the name of a feature cannot be reused by a second feature, and its unit test
now depends on that feature's constants file.

`SUPPORTED_EXT` and `MAX_SIGNATURE_CHARS` describe *what the parsers parse* — they are properties of
the adapter, not of repo-intel. Create `src/adapters/astgrep/constants.ts`:

```ts
/** File extensions the AST parsers understand. A property of the parser, not of any feature. */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
/** Signatures are trimmed to this many chars at parse time (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
```

**Do not have `modules/repo-intel/` re-export them.** R2 may not import R4, so the module cannot
reach into the adapter for them either. Keep `SUPPORTED_EXT` in `modules/repo-intel/constants.ts`
as the module's own **walk scope**, and let the adapter own its **parse scope** separately.

Two lists with the same value today, and that is fine — they have different owners and are allowed
to diverge. The adapter's says *what the parser understands*; the module's says *what is worth
walking*. Collapsing them into one shared constant is precisely what created the violation.

**Verify:**

```bash
grep -raEn "^import .*from '.*modules/" src/adapters --include=*.ts   # expect 0
```

---

## Step 3 — V9: stop importing a tool

**Found:** `src/adapters/auth/local.ts:5` imports `DEFAULT_WORKSPACE_NAME`, `SYSTEM_USER_EMAIL`
from `../../db/seed.js`.

`db/seed.ts` is a **tool** — it has a `main()`, it reads `process.env.DATABASE_URL`, it is meant to
be run, not imported. Importing it drags the whole seeding module into the adapter's graph and
makes an adapter transitively depend on a script.

Create `src/db/constants.ts`:

```ts
/** Identity of the single local workspace/user in the no-auth MVP. Shared by the seeder and the auth adapter. */
export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';
```

Point both `db/seed.ts` and `adapters/auth/local.ts` at it.

**Verify:**

```bash
grep -rn "db/seed\|db/migrate" src --include=*.ts | grep -v "^src/db/"   # expect 0
```

---

## Step 4 — `platform/infra/` + delete the shims

Two independent moves, batched because they touch the same folder.

**4a. Relocate the three I/O owners.** `git mv` each, then fix importers:

| From | To | Why |
|---|---|---|
| `platform/jobs.ts` | `platform/infra/jobs.ts` | durable queue over the `jobs` table — imports `drizzle-orm` + `db/schema` |
| `platform/sse.ts` | `platform/infra/sse.ts` | process-global `EventEmitter` |
| `platform/prompts.ts` | `platform/infra/prompts.ts` | `node:fs` template loader |

`platform/run-logger.ts` keeps `import type { RunBus } from './infra/sse.js'` — type-only, so no
runtime edge from R1 to R4 is created. That import is legal and stays.

**4b. Delete the three re-export shims.** `platform/{grounding,prompt,structured}.ts` re-export from
`@devdigest/reviewer-core` and nothing else. Six importers, all mechanical:

| Importer | Shim |
|---|---|
| `src/adapters/llm/anthropic.ts:12` | `structured.js` → `@devdigest/reviewer-core` |
| `src/adapters/llm/openai.ts:11` | `structured.js` → `@devdigest/reviewer-core` |
| `test/adapters.test.ts:10` | `prompt.js` |
| `test/adapters.test.ts:11` | `grounding.js` |
| `test/grounding.test.ts:3` | `grounding.js` |
| `test/prompt-structured.test.ts:3-4` | `prompt.js`, `structured.js` |

The two `src/` hits are the point: today an *adapter* appears to depend on the *kernel* when it
actually depends on the engine. A shim that misreports the dependency graph is worse than no shim,
because every future reader and every future linter believes it.

**Also delete two dead barrels** while in the area — both have zero importers:
`src/adapters/index.ts` and `src/modules/repo-intel/index.ts`. The latter additionally re-exports
`./repository.js`, which would leak R3 outside its module the moment anyone used it.

---

## Step 5 — V3: type leaks → `db/rows.ts`

**Found — all three are `typeof schema.repos.$inferSelect` in a *type position only*:**

| File | Line | Occurrences |
|---|---|---|
| `src/modules/reviews/run-executor.ts` | 5 (import), 58, 141 | 2 uses |
| `src/modules/reviews/diff-loader.ts` | 4 (import), 17 | 1 use |
| `src/modules/repos/helpers.ts` | 2 (import), 50 | 1 use |

None of the three imports `drizzle-orm` — no query is being built. They import the whole schema
namespace to read one row shape. **The fix is three lines.**

Add to `src/db/rows.ts`:

```ts
export type RepoRow = typeof t.repos.$inferSelect;
```

Then in each file, replace `import * as schema from '../../db/schema.js'` with
`import type { RepoRow } from '../../db/rows.js'`, and
`typeof schema.repos.$inferSelect` → `RepoRow`.

**Growing `db/rows.ts` is the correct response to "I need a row shape in a service"** — it is not a
workaround. The file already exists with exactly this rationale in its header.

Two hits in that same grep are **not** bugs and must be left alone:
- `platform/jobs.ts` — blessed, handled by step 4a (relocate, don't rewrite).
- `adapters/auth/local.ts` — blessed. An adapter's backing store is allowed to be Postgres; that is
  what R4 means.

---

## Step 6 — V7: `Parameters<>` over re-declared types

**Found:** `src/modules/reviews/repository.ts` (186 lines) is a class façade over the free functions
in `repository/{pull,review,run}.repo.ts`. Roughly 15 methods re-declare the underlying function's
parameter object type inline instead of deriving it.

There is a receipt: [server/INSIGHTS.md](../../../../server/INSIGHTS.md), 2026-08-09 — adding a field
to an agent run required editing *both* copies, and missing the wrapper produced a `TS2353`
"unknown property" **at the call site in `run-executor.ts`, not at the repository.** The error
points at the wrong file, which is what makes this pattern expensive rather than merely redundant.

`completeAgentRun` is the worked example — a 14-line object type, duplicated verbatim:

```ts
// BEFORE — modules/reviews/repository.ts
completeAgentRun(
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    score?: number | null;
    blockers?: number | null;
    costUsd?: number | null;
    error?: string | null;
  },
): Promise<void> {
  return runRepo.completeAgentRun(this.db, runId, values);
}

// AFTER — one line, and it cannot drift
completeAgentRun(
  runId: string,
  values: Parameters<typeof runRepo.completeAgentRun>[2],
): Promise<void> {
  return runRepo.completeAgentRun(this.db, runId, values);
}
```

**Do not restructure the class away.** The split-by-aggregate underneath is good, and the
free-function form (`db` as the first parameter) is exactly what makes a future
`Db | Transaction` widening possible. Kill only the duplication. Mechanical pass over ~15 methods;
`Parameters<T>[n]` where `n` is the index *after* `db` is dropped by the wrapper. No call-site churn,
so `pnpm typecheck` is the whole verification.

Return types can be derived the same way where they are re-declared:
`ReturnType<typeof runRepo.completeAgentRun>`.

---

## Step 7 — V1: `Deps` per module

**Found — 10 files import `Container`; one of them (`modules/_shared/context.ts`) is legal, so 9
are violations:**

| File | Line |
|---|---|
| `src/modules/agents/service.ts` | 1 (ctor at 54) |
| `src/modules/repo-intel/service.ts` | 21 (ctor at 104) |
| `src/modules/repos/service.ts` | 1 (ctor at 36) |
| `src/modules/reviews/service.ts` | 1 (ctor at 33) |
| `src/modules/reviews/run-executor.ts` | 1 (ctor param at 45) |
| `src/modules/reviews/diff-loader.ts` | 1 |
| `src/modules/repo-intel/pipeline/full.ts` | 27 |
| `src/modules/repo-intel/pipeline/incremental.ts` | 20 |
| `src/modules/settings/feature-models.ts` | 7 |

### The structural-compatibility trick

**This is why the migration is nearly free, and it is verified, not assumed** — the recipe below
was applied to `modules/repos/service.ts` and `pnpm typecheck` passed with every call site
untouched (see the README's *Verification performed*).

`Container` exposes `db`, `jobs`, `git`, `secrets`, `config`, `runBus`, `llm(id)`, `github()`,
`repoIntel`, `agentsRepo`, `reviewRepo`, `depgraph`, `tokenizer`, `priceBook` as public
members/getters. TypeScript's structural typing therefore means **`Container` already satisfies any
`Deps` interface built from that set** — no adapter object, no container change, no call-site edit.

```ts
// BEFORE — modules/repos/service.ts
import type { Container } from '../../platform/container.js';

export class RepoService {
  private repo: RepoRepository;
  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }
  // ... this.container.jobs / .secrets / .git
}

// AFTER
import type { GitClient, SecretsProvider } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { JobRunner } from '../../platform/infra/jobs.js';

export interface RepoServiceDeps {
  db: Db;
  jobs: JobRunner;
  git: GitClient;
  secrets: SecretsProvider;
}

export class RepoService {
  private repo: RepoRepository;
  constructor(private deps: RepoServiceDeps) {
    this.repo = new RepoRepository(deps.db);
  }
  // ... this.deps.jobs / .secrets / .git
}
```

`new RepoService(app.container)` in `modules/repos/routes.ts` **keeps compiling untouched.**

### The recipe, per service

1. Grep the file for `this.container.` — the property names are the `Deps` fields.
2. Write the interface above the class. Import the types from `@devdigest/shared` (ports),
   `db/client.js` (`Db`, type-only), and `platform/infra/jobs.js` (`JobRunner`).
3. `s/this\.container\./this.deps./`
4. `constructor(private container: Container)` → `constructor(private deps: XServiceDeps)`
5. Delete `import type { Container }`.
6. `pnpm typecheck`. Nothing else should move.

### Two shapes that need care

**Lazy resolvers.** `container.github()` and `container.llm(id)` resolve secrets on call and must
stay lazy — booting with no API keys is a product requirement. Declare the *resolver*, not the
resolved client:

```ts
export interface ReviewServiceDeps {
  db: Db;
  github: () => Promise<GitHubClient>;            // not: github: GitHubClient
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
}
```

Still structurally satisfied by `Container` — `github()` and `llm()` are methods, and a method is a
function-valued property.

**Free functions, not classes.** `feature-models.ts`, `diff-loader.ts` and the two pipeline files
take `container` as a plain parameter. Same treatment: replace the parameter type with a `Deps`
interface. For `feature-models.ts` this falls out of step 8 anyway — it is being split.

### What this unlocks

Hermetic service tests that do not fight the type system. Today the two that exist
(`test/repo-intel-facade-degraded.test.ts`, `test/repo-intel-resync.test.ts`) build a fake container
with `as never` and then write a private field:

```ts
// BEFORE — the service-locator tax
const container = { config: {...}, db: {} as never, codeIndex: {...} } as never;
const svc = new RepoIntelService(container);
(svc as unknown as { repo: Record<string, unknown> }).repo = { getRepoBasics: async () => null, ... };

// AFTER — an object literal, type-checked
const svc = new RepoIntelService({ config, db, codeIndex, repo: fakeRepo });
```

The `as never` casts are not a testing-style problem. They are the pattern billing you.

**Migration marker:** while any `import type { Container }` line remains under `src/modules/`
(other than `_shared/context.ts`), that module has not migrated. One grep, one second.

---

## Step 8 — V2: extract `pulls` and `settings`

The expensive one, and the reason it is last.

### `pulls` — 381 lines, ~18 inline `container.db` queries

`src/modules/pulls/routes.ts` is the clearest case in the repo: **the HTTP handler *is* the
repository**, and the operation "import PRs from GitHub" has no callable name — so it cannot be
reused by the poller, cannot be tested without booting Fastify, and cannot be scheduled.

Target shape:

```
modules/pulls/
├── routes.ts        # 4 handlers, ~60 lines, no drizzle-orm import
├── service.ts       # takes PullsServiceDeps { db, github: () => Promise<GitHubClient> }
├── repository.ts    # every query from routes.ts, module-private
├── helpers.ts       # PullRow -> PrMeta / PrDetail mapping (the ~25-line object literals)
├── constants.ts     # BACKFILL_LIMIT
└── status.ts        # already correct — leave it
```

Order of extraction, so each commit compiles and the tests stay green:

1. **`repository.ts` first.** Move each query verbatim as a method taking scalars. Nothing else
   changes yet; `routes.ts` calls `new PullsRepository(container.db)`. The `drizzle-orm` and
   `db/schema` imports leave `routes.ts` in this step — the single biggest win, taken first.
2. **`helpers.ts` next.** The two large row→DTO object literals (`routes.ts:188-214` and
   `:280-307`) are pure functions with a row in and a contract out. Move them; they become the
   module's only place a `PullRow` meets a `PrMeta`.
3. **`service.ts` last**, absorbing the branching: the GitHub-available/offline fallbacks, the
   diff-stat backfill loop, the dedup-and-tally over findings, the `resolvePrAndRepo` closure.
   Each becomes a named method. This is where the module stops being a script.
4. `routes.ts` ends as four handlers doing the four permitted things.
5. Add `schema.response` to all four while the DTOs are freshly named.

The findings dedup + severity rollup at `routes.ts:148-185` is worth its own helper with its own
hermetic test — it is pure logic over rows and currently untestable.

### `settings` — a repository wearing a helper's name

`src/modules/settings/feature-models.ts` (57 lines) is the worked example from SKILL §8:
*"if placement needs a debate, it is two files in two rings."* It holds two unrelated things:

| Piece | Ring | Goes to |
|---|---|---|
| `DEFAULTS` + `defaultFeatureModel()` — a registry derived from the R0 `FEATURE_MODELS` contract, no I/O | R2 | stays in `feature-models.ts` (or `constants.ts`) |
| `getFeatureModelOverride()` / `resolveFeatureModel()` — a `select` over `t.settings` | R3 | `repository.ts` |

`settings/routes.ts` (98 lines, 3 inline `container.db` queries) gets the same treatment as `pulls`,
at a fraction of the size. Do `settings` **first** — it is the same shape, small enough to finish in
one sitting, and it establishes the pattern the `pulls` extraction then follows.

---

## Not on this list, by decision

| Thing | Why it stays |
|---|---|
| Repository interfaces (V4) | One implementation. The property that matters — application code cannot write SQL — is bought by the import rule alone. Promote on the second implementation, never before |
| `container.ts` importing module repositories/services (V5) | That is what a composition root is. Bounded: `repository.ts` / `service.ts` only |
| `polling/` and `workspace/` having no service (V2b) | Genuine pass-throughs. The named shrink-only exception |
| A linter | SKILL §6 — deliberate, with the door left open |
