# Development Plan: Onboarding Generator

**Date:** 2026-07-03
**Requirements:** [docs/feature-requirements/2026-07-03-onboarding-generator.md](../feature-requirements/2026-07-03-onboarding-generator.md) (Status: draft)
**Execution mode:** multi-agent
**Scope:** full-stack (server · client · repo-intel facts)
**Affects modules:** `server/src/modules/onboarding/` (new), `server/src/db/schema/context.ts` (extend), `server/src/db/migrations/` (new `0015`), `server/src/modules/repo-intel/pipeline/walk.ts` (harden), `server/package.json` + `pnpm-lock.yaml` (new `ignore` dependency), `server/src/adapters/github/octokit.ts` + `server/src/vendor/shared/adapters.ts` + `client/src/vendor/shared/adapters.ts` (extend, both copies), `server/src/vendor/shared/contracts/` + `client/src/vendor/shared/contracts/` (new `onboarding-tour.ts`, mirrored), `server/src/prompts/onboarding.system.md` (edit), `server/src/modules/index.ts` (register), `client/src/app/repos/[repoId]/onboarding-tour/` (new), `client/src/vendor/ui/nav.ts` (extend), `client/src/components/app-shell/helpers.ts` (fix), `client/messages/en/onboarding.json` (reconcile existing), `client/src/lib/hooks/` (new `onboarding.ts`)

---

## 1. Context

A newcomer to an unfamiliar repository has no fast, trustworthy way to understand its architecture, how to run it, and where to start reading. This feature generates a one-page "Onboarding Tour" per repository: deterministic code computes every fact (stack, structure, routes, scripts, import graph, file importance) at zero LLM cost via the existing `repo-intel` facade, and exactly ONE structured LLM call turns those facts into readable narrative across 5 fixed sections. The tour is persisted so re-opening the page is instant, with a manual "Regenerate" action.

The codebase already contains several load-bearing pieces of prior infrastructure that this plan builds on rather than re-creates: an unregistered `onboarding` DB table (`server/src/db/schema/context.ts:120-126`, JSONB blob + timestamp per repo), a structured-output system prompt (`server/src/prompts/onboarding.system.md` — needs editing, not just reuse, see Step 6), repo-intel facade methods explicitly documented as built for this feature (`getTopFilesByRank`, `getCriticalPaths` — both docstring-labeled "onboarding reading-path" in `server/src/modules/repo-intel/service.ts`), a partial i18n namespace (`client/messages/en/onboarding.json` — has a different section list than this spec and must be reconciled, not replaced blindly), and placeholder shared contracts (`OnboardingSection`/`OnboardingLink`/`Onboarding` in `server/src/vendor/shared/contracts/knowledge.ts:29-47` — these are a DIFFERENT, older shape and are kept as-is; this plan's new contracts use distinct names, see Step 4). The plan's job is to wire the real pieces together, add the genuinely new pieces (lite-mode GitHub Trees/Contents reads, and the repo-wide route aggregator over `file_facts`), and harden the shared `walk.ts` indexing gap that blocks the repo-isolation acceptance criteria (AC-13/AC-14).

A staff-engineer review of the first draft of this plan found four blocking issues (naming collision with existing `knowledge.ts` contracts, an untestable rate-limit assumption, an unedited/mismatched system prompt, and an unbounded LLM-input risk) plus six non-blocking gaps (nav-highlight collision, adapter mirror omission, missing rate-limit `keyGenerator`, workspace-ownership-by-query-not-by-discipline, missing dependency-files ownership, and a note on stale-index scope). All ten are incorporated below.

## 2. Architecture Fit

New Fastify module `server/src/modules/onboarding/` (routes → service → repository), registered statically in `modules/index.ts`, following the `blast` module as the direct structural template (same PR-domain-read pattern, same `BlastIndexInfo`-style vocabulary reuse, same `container.repoIntel.*` consumption).

- **Persistence**: the existing `onboarding` table (`server/src/db/schema/context.ts`) is extended additively via a new migration `0015_onboarding_metadata.sql` — never altered in place, never re-created. See §4 for the exact column list and the workspace-scoping resolution.
- **Full-mode facts**: consumed entirely through `container.repoIntel.*` (already implemented, zero new ranking/graph code) plus direct-clone reads (`package.json`, `.env.example`, docker-compose) and one new repository method aggregating `file_facts` repo-wide (new — the per-file `getFileFacts` today takes an explicit path list, not "all files"). This aggregation result is a raw inventory API, NOT LLM input directly — see the bounding rule in §4 and Step 6.
- **Lite-mode facts**: two new methods added to the `GitHubClient` port, mirrored in BOTH `server/src/vendor/shared/adapters.ts` and `client/src/vendor/shared/adapters.ts` (interface-only on the client copy — no client caller needs them, but the two copies must stay structurally identical per the established two-copies convention), and implemented in `OctokitGitHubClient` — Git Trees (recursive) and Contents (single file) — consumed only by the onboarding service, never by other modules in this plan.
- **LLM call**: exactly one `container.llm(provider).completeStructured(...)` call per generation, mirroring `ConventionExtractor.extract()` (`server/src/modules/conventions/extractor.ts`) almost line-for-line: resolve model via `resolveFeatureModel(container, workspaceId, 'onboarding')` (registry entry already exists in `FEATURE_MODELS`), build a BOUNDED input from ranked facts (explicit caps, see §4/Step 6), one `completeStructured` call, map `costUsd → cents`.
- **Ordering ownership**: the SERVER, not the LLM, owns Guided reading path order (AC-7). The server computes the rank-ordered list via `getTopFilesByRank` BEFORE the LLM call, sends only the bounded top-N entries to the LLM for narrative/rationale text, and re-attaches/re-sorts the LLM's per-entry rationale onto the server-computed rank-DESCENDING order AFTER the LLM responds. The LLM's output order is never trusted as final order.
- **Repo isolation hardening**: `server/src/modules/repo-intel/pipeline/walk.ts` gains `.gitignore` honoring and nested-repo-metadata skipping. This is shared indexing infrastructure — the fix benefits every repo-intel consumer, not just onboarding, and is scoped as its own independent step with its own tests derived from AC-13/AC-14. **Scope note**: this hardening applies to files walked at INDEX TIME. A repository indexed before this fix ships retains its previously-walked (unfiltered) fact set until a re-index/resync is triggered (`POST /repos/:id/resync` or a fresh clone) — AC-13/AC-14 are satisfied for all NEWLY indexed or explicitly resynced repos, not retroactively for already-indexed ones. This is a property of the existing incremental-index design (only changed files get re-walked on refresh), not a gap this plan introduces.
- **Client**: new repo-scoped route `client/src/app/repos/[repoId]/onboarding-tour/` (Server Component shell awaiting `params`, mirroring `context/page.tsx`), new sidebar nav entry, corrected shell nav-highlight matching, new `_components/OnboardingTourView/` tree with 5 section components + shared card chrome, new `useOnboardingTour`/`useGenerateOnboardingTour` hooks via TanStack Query.

**Route path decision**: `repos/[repoId]/onboarding-tour` — NOT `repos/[repoId]/onboarding`, which collides with the existing unrelated "Add new repository" route at `client/src/app/onboarding/`.

**Contract naming decision (resolves a blocking review finding)**: `server/src/vendor/shared/contracts/knowledge.ts:29-47` ALREADY defines `OnboardingLink`, `OnboardingSection`, and `Onboarding` — an older, different-shaped placeholder, already barrel-exported in both `vendor/shared` copies. These are left completely untouched (no edits, no removal — removing them would be an unrequested breaking change to whatever currently imports them, and this plan's mandate is additive). This plan's new persisted/API types use the non-conflicting names `OnboardingTour`, `OnboardingTourSection`, `OnboardingTourLink`, `OnboardingTourTask`, `OnboardingTourRunMetadata` — see Step 4.

## 3. Skills & Patterns Applied

**backend-onion-architecture**: new module strictly follows `routes.ts` → `service.ts` → `repository.ts`; adapters only via `container.*` (never `new OctokitGitHubClient()` in service); `AppError` subclasses for all expected failures; every repository query workspace-scoped via join, enforced MECHANICALLY inside the query itself (R1) — not by service call-order discipline (see Step 6, `upsertTour`); static registration in `modules/index.ts` (R7); no cross-module internal imports — lite-mode GitHub reads go through `container.github()`, full-mode facts through `container.repoIntel`.

**fastify-best-practices**: route schemas via Zod + `fastify-type-provider-zod`; rate limiting via Fastify's `config.rateLimit` on the generation route only, with a custom `keyGenerator` (see §4 — the `@fastify/rate-limit` default keys by IP, which does not implement "per-workspace").

**zod**: `OnboardingTour`/`OnboardingTourSection`/`OnboardingTourLink`/`OnboardingTourTask`/`OnboardingTourRunMetadata` schemas drive both the persisted-row parse and the API response type; the LLM structured-output schema (narrative sections only) is a distinct, narrower Zod schema passed to `completeStructured`.

**drizzle-orm-patterns / postgresql-table-design**: additive-only migration (new columns, `NOT NULL DEFAULT` to satisfy existing-empty-table safety, no rewrite risk since the table is currently unregistered and empty); no new indexes needed beyond the existing PK (`repo_id`) since all reads are single-row-by-repo.

**react-best-practices / frontend-architecture**: data fetching in hooks only (`useOnboardingTour`, `useGenerateOnboardingTour`), never in component bodies; container/presentational split (`OnboardingTourView` fetches, section components are presentational); co-located `_components/` per the existing `context`/`pulls` convention.

**next-best-practices**: Server Component page shell awaits `params` per Next 15 convention (mirrors `context/page.tsx`, the one page in the codebase already doing this correctly per `client/insights.md` 2026-07-03).

**mermaid-diagram**: the LLM emits raw mermaid syntax for the architecture/how-to-run diagrams (per the EDITED system prompt's rules — `flowchart LR/TD` only, quoted labels, no diagram≠null placeholders); the assembler deterministically appends a `classDef`/`style` block keyed by node-kind AFTER the LLM returns — colors are never LLM-authored.

**security**: README content (lite mode) and any repo-content facts fed to the LLM are wrapped in `<untrusted>…</untrusted>` per the existing prompt's already-established convention (§18 of the spec — no new prompt-injection surface, this is data-only, never instructions); file-path traversal guards on `readFile` for `package.json`/`.env.example`/docker-compose mirror the exact `resolve(repoRoot, path).startsWith(repoRoot)` pattern in `conventions/extractor.ts`; the generation endpoint is rate-limited to prevent paid-LLM-call fan-out (AC-16), keyed per-workspace (not per-IP) so the limit cannot be trivially bypassed by rotating source IPs within the same workspace; no secrets are ever included in the bounded LLM input (`.env.example` is explicitly the *example* file, never `.env`); the LLM input bundle is EXPLICITLY CAPPED (route counts, file counts, byte budgets — see §4) so a large or adversarially bloated repo cannot turn one generation into an unbounded-cost/unbounded-context call.

## 4. Project Constraints

- **Workspace scoping**: `onboarding` table has no `workspace_id` column and none is added (avoids 3NF-violating duplication of `repos.workspace_id`). Every repository query — reads AND writes — joins `onboarding` → `repos` and filters `repos.workspace_id = $workspaceId` MECHANICALLY inside the SQL itself (the established codebase pattern for tables lacking their own column: precedent `BlastRepository.getPr`, `pull.repo.ts`'s `getBrief`). Ownership is never enforced only by "the service already checked earlier" — the write query itself must be incapable of touching a cross-workspace row, per R1 and AP-3 in the onion-architecture skill.
- **Migration additivity**: `0015_onboarding_metadata.sql` adds only new nullable/defaulted columns to the existing empty, unregistered `onboarding` table. Never alters `repo_id`, `json`, or `generated_at`. Never edits any applied migration file.
- **DB schema is stable** — one migration, this feature only; no bundling with logic changes.
- **`reviewer-core` is untouched** — this feature does not use `groundFindings()` or `assemblePrompt()`; it is a separate structured-output call path (`container.llm(...).completeStructured`), same pattern as `ConventionExtractor`, deliberately outside reviewer-core's citation-gate machinery (the spec has no "grounding" requirement — narrative claims are the LLM's, bounded by facts, not per-citation graded).
- **Secrets via `SecretsProvider` only** — no `process.env` reads anywhere in the new module; GitHub token and LLM keys resolved exclusively through `container.secrets`/`container.github()`/`container.llm()`.
- **Adapters only via Container** — the two new `GitHubClient` methods are called through `container.github()`, never a direct `new OctokitGitHubClient()`.
- **Shared contracts** — `onboarding-tour.ts` added to `server/src/vendor/shared/contracts/` AND separately mirrored into `client/src/vendor/shared/contracts/` in the same task (these are two physically distinct copies per `client/insights.md` 2026-07-02 — a divergence breaks client typecheck silently). New names (`OnboardingTour*`) are chosen specifically to avoid colliding with the EXISTING `Onboarding`/`OnboardingSection`/`OnboardingLink` placeholders in `knowledge.ts`, which are untouched.
- **`server/src/vendor/shared/adapters.ts` AND its client mirror `client/src/vendor/shared/adapters.ts` are both additive-only in this plan** — two new methods added to the `GitHubClient` interface in BOTH copies; no existing method signature is changed in either. This still counts as touching a shared port and is called out explicitly as a Wave-1 task with narrow, reviewable scope.
- **Rate limiting**: generation endpoint (`POST`) rate-limited to **3 requests/minute per workspace**, mirroring the `review-all` precedent (per-route, not per-repo) — satisfies AC-16. Because `@fastify/rate-limit`'s default key is the client IP (which does not implement "per workspace" and is actively wrong behind a shared proxy/dev tunnel), the route config supplies a custom `keyGenerator: (req) => workspaceId-of(req)` — resolved via the SAME `getContext(container, req)` call the handler already makes, cached on `req` for the single request so `keyGenerator` and the handler body don't each independently call `container.auth.currentWorkspace()`. See Step 6 for the exact implementation shape.
- **Rate-limit testing constraint (resolves a blocking review finding)**: `server/src/app.ts:121-125` disables the entire `@fastify/rate-limit` plugin whenever `config.nodeEnv === 'test'`, specifically so integration suites can hammer endpoints via `app.inject()`. This means a STANDARD hermetic test using the app's normal test-mode `buildApp()` call CANNOT observe a real 429 — the plugin isn't even registered. This plan does **not** special-case a dedicated rate-limit-enabled app instance for one test (that would require constructing `buildApp` with a non-test `nodeEnv` override just for this route, which risks reintroducing the exact `app.inject()` flakiness the global disable was added to prevent, for a single low-value assertion). Instead: **AC-16's automated coverage is a static assertion on the route's registered config** — a hermetic test inspects the Fastify route table (via `app.printRoutes({ commonPrefix: false })` or by asserting on the route's `routeOptions.config.rateLimit` object directly after registration) and asserts `{ max: 3, timeWindow: '1 minute' }` plus the presence of the custom `keyGenerator`. Real 429-producing behavior under load is verified only in the AC-17 manual walkthrough (Step 8), which now explicitly includes "click Regenerate 4 times within a minute and confirm the 4th is rejected."
- **One LLM call invariant**: the service has exactly one call site to `completeStructured` for the narrative; any retry/backoff internal to `completeStructured` (`maxRetries`) is a single logical call from the AC-5/AC-6 accounting perspective — cost is logged from the single `StructuredResult`, not summed across retries.
- **Zero LLM in facts/ranking**: `getTopFilesByRank`/`getCriticalPaths`/`getFileRank`/`getConventionSamples`-style calls, the new `getAllFileFacts` aggregator, and the two new GitHub Trees/Contents reads are all pure I/O — no LLM involvement (AC-4).
- **Bounded LLM input (resolves a blocking review finding)**: `getAllFileFacts` (Step 5) is a repo-wide AGGREGATION API — it is correct and intentional for it to return the complete `file_facts` inventory with no cap, because other future consumers may need the full set. It is NEVER passed to the LLM unbounded. `buildLlmInput` (Step 6) applies explicit caps when assembling the bundle actually sent to `completeStructured`:
  - `LLM_INPUT_MAX_ENDPOINTS = 60` total routes/endpoints across the whole bundle (after dedup)
  - `LLM_INPUT_MAX_ROUTES_PER_FILE = 10` (a single hub file's inventory is truncated, not dumped whole, mirroring the spirit of blast's `HUB_ENDPOINT_LIMIT` even though `getAllFileFacts` itself stays uncapped)
  - `LLM_INPUT_TOP_N_FILES = 20` ranked files max for the reading-path/critical-path narrative input
  - `LLM_INPUT_MAX_BYTES = 40_000` — a hard byte-budget ceiling on the assembled input string (stack facts + routes + critical-path chains + top-N file summaries + any lite-mode README/package.json excerpt combined); if the naturally-capped bundle still exceeds this, `buildLlmInput` truncates the LOWEST-priority section first (routes list, then critical-path chains, then per-file one-line summaries) until under budget — never truncates mid-entry (no partial route strings, no partial file paths).
  - Full file CONTENTS are never included — only paths, one-line facts, and aggregate counts, consistent with the "never full file contents" non-goal.
- **Never touch**: `server/src/vendor/shared/` beyond the additive file/interface changes explicitly scoped here (never touching the existing `Onboarding`/`OnboardingSection`/`OnboardingLink` placeholders in `knowledge.ts`); `server/drizzle/`-style applied migrations (never edit in place); `reviewer-core/src/grounding.ts`.

---

## 5. Implementation Steps

### Parallelization Map (multi-agent)

```
Wave 1 (4 independent tracks — no shared owned paths, no cross-dependencies):
  Step 1: DB migration 0015                         [server/src/db/schema, server/src/db/migrations]
  Step 2: walk.ts gitignore/nested-repo hardening    [server/src/modules/repo-intel/pipeline/walk.ts + tests, server/package.json, pnpm-lock.yaml]
  Step 3: GitHub Trees/Contents adapter methods      [server/src/vendor/shared/adapters.ts, client/src/vendor/shared/adapters.ts, server/src/adapters/github/octokit.ts, server/src/adapters/mocks.ts]
  Step 4: Shared contracts (onboarding-tour.ts, both copies) [server/src/vendor/shared/contracts, client/src/vendor/shared/contracts]

Wave 2 (depends on Wave 1; 2 independent tracks once their Wave-1 deps land):
  Step 5: repo-intel repo-wide file_facts aggregator  [server/src/modules/repo-intel/repository.ts, service.ts, types.ts]
           depends on: none from Wave 1 directly (touches only repo-intel; can actually start in Wave 1 —
           see note below), but grouped here because it is a prerequisite for Step 6.
  Step 6: onboarding server module (routes/service/repository/helpers) + system prompt edit
           [server/src/modules/onboarding/**, modules/index.ts, server/src/prompts/onboarding.system.md]
           depends on: Step 1 (migration/schema), Step 3 (GitHub adapter), Step 4 (contracts), Step 5 (aggregator)
  Step 7: onboarding client page + components + hooks + nav fix + i18n reconciliation
           [client/src/app/repos/[repoId]/onboarding-tour/**, client/src/lib/hooks/onboarding.ts,
            client/src/vendor/ui/nav.ts, client/src/components/app-shell/helpers.ts, client/messages/en/onboarding.json]
           depends on: Step 4 (contracts) only — proceeds against a mocked API per client hermetic testing convention, in parallel with Step 6

Wave 3 (integration — depends on Steps 6 and 7 both landing):
  Step 8: end-to-end wiring check + manual AC-16/AC-17 verification (small, sequential closer)
```

**Note on Step 5**: `getAllFileFacts`-style aggregation only touches `repo-intel/repository.ts` + `service.ts` + `types.ts` — disjoint from Steps 1–4's owned paths. It could run in Wave 1 as a 5th independent track. It is listed under Wave 2 here only because Step 6 cannot start without it and grouping keeps the dependency chain legible; an implementer fleet with 5 free slots MAY start Step 5 in Wave 1 alongside Steps 1–4 — there is no file collision either way.

---

### Step 1: Extend the `onboarding` table via migration 0015

**Dependencies:** none
**Owned paths:** `server/src/db/schema/context.ts` (edit — add columns to the existing `onboarding` table definition only), `server/src/db/migrations/0015_onboarding_metadata.sql` (new), `server/src/db/migrations/meta/0015_snapshot.json` (generated), `server/src/db/migrations/meta/_journal.json` (append entry)

**What to do:**
1. In `server/src/db/schema/context.ts`, extend the existing `onboarding` pgTable definition (lines 120-126) with five new columns — do NOT touch `repoId`, `json`, or `generatedAt`:
   - `mode: text('mode', { enum: ['full', 'lite'] }).notNull().default('full')`
   - `indexStatus: text('index_status', { enum: ['full', 'partial', 'degraded', 'failed'] }).notNull().default('degraded')`
   - `degraded: boolean('degraded').notNull().default(true)`
   - `degradedReason: text('degraded_reason')` (nullable, no default)
   - `llmCostCents: integer('llm_cost_cents')` (nullable, no default — "null = cost unknown" per the contract)
2. Run `cd server && pnpm db:generate` to emit migration `0015_onboarding_metadata.sql` and its matching snapshot/journal entry. Before trusting the output, inspect the generated SQL: it must contain ONLY `ALTER TABLE onboarding ADD COLUMN ...` statements — no `ALTER COLUMN`, no `DROP`, no touching of any other table. If `db:generate` reports "No schema changes" or touches unrelated tables, STOP and follow the diagnostic procedure in `server/insights.md` (2026-07-03 Mistake entries on snapshot chain corruption) before proceeding — do not hand-edit the snapshot chain speculatively.
3. Apply locally with `pnpm db:migrate` and verify via `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d onboarding"` that all 8 columns exist with the expected types/defaults.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm db:migrate` applies cleanly against a fresh DB and against the current dev DB
- [ ] `\d onboarding` shows `repo_id, json, generated_at, mode, index_status, degraded, degraded_reason, llm_cost_cents` with no changes to the first three columns' types/constraints
- [ ] A second `pnpm db:generate` run reports no further schema changes (chain is clean)

**Commit:** `feat(onboarding): extend onboarding table with mode/index-health/cost columns (migration 0015)`

---

### Step 2: Harden `walk.ts` — honor `.gitignore` and skip nested repo metadata

**Dependencies:** none
**Owned paths:** `server/src/modules/repo-intel/pipeline/walk.ts`, `server/test/walk.test.ts` (new or extended — check for an existing `walk` test file first and extend rather than overwrite), `server/package.json` (add `ignore` dependency), `server/pnpm-lock.yaml` (lockfile update from the install)

**What to do:**
1. Add the `ignore` npm package as a new dependency (`cd server && pnpm add ignore`) — this is the TODO already documented at `walk.ts:14-18` ("TODO(T3): wire `ignore` once we accept a new dep"). This command edits both `server/package.json` and the root/`server` lockfile — both are owned by this step; commit them together with the code change, never separately.
2. In `walkClone(root)`, before starting the directory walk: attempt to read `.gitignore` from `root` (best-effort — missing file is not an error, just means no ignore rules). Build an `ignore()` instance from its contents. Also recursively pick up any nested `.gitignore` files as the walk descends (standard git semantics: closer `.gitignore` rules apply to their subtree) — implement this by testing each candidate relative path against the root-level `ignore()` instance at minimum (a single root `.gitignore` check is the mandatory baseline for AC-13; nested `.gitignore` merging is a nice-to-have if time allows within this step, not a separate step).
3. In `walkDir`, before recursing into a directory or accepting a file, test its repo-relative path against the `ignore()` instance; skip if ignored.
4. Add nested-repository detection: when `entry.isDirectory()` and `name === '.git'`, this is ALREADY excluded by `EXCLUDED_DIRS` at the top level, but a NESTED `.git` directory (i.e., `.git` found in ANY subdirectory, not just `root/.git`) indicates a nested repository working tree and must also cause the walk to skip that entire subtree — not just the `.git` folder itself. Detect this by checking, for every directory being recursed into (other than `root` itself), whether it contains a `.git` entry (file or directory — submodules use a `.git` FILE pointing at the parent's gitdir) BEFORE walking its children; if found, skip the whole subtree and record it in `stats` (add a new `stats.skippedNestedRepo: number` counter, incremented once per skipped subtree root).
5. Update `WalkStats` interface to include `skippedNestedRepo: number` and `gitignoredCount: number` (candidates dropped by `.gitignore`, for observability parity with `skippedTooLarge`).
6. Update the file's header comment to remove the "NOT YET HANDLED" section since it is now handled; briefly document the two new stats fields; add a one-line note that this hardening applies to files walked from the point this ships forward — a previously-indexed repo needs a resync (`POST /repos/:id/resync`) to have its existing fact set re-filtered (documents the scope note from §2).

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic tests pass, including new/extended test cases for: (a) a file matching a `.gitignore` pattern is excluded from `WalkResult.files`, (b) a nested directory containing its own `.git` entry is fully excluded (none of its descendant files appear in the result) and `stats.skippedNestedRepo` increments, (c) a repo with no `.gitignore` at all still walks normally (no regression, missing file ≠ error)
- [ ] Existing walk.ts tests (if any) still pass unmodified in behavior for non-gitignore, non-nested-repo cases
- [ ] `server/package.json` and the lockfile diff both appear in the same commit

**Commit:** `fix(repo-intel): honor .gitignore and skip nested repository trees in walkClone`

---

### Step 3: Add GitHub Trees + Contents API methods (lite-mode fact source, both adapter-port copies)

**Dependencies:** none
**Owned paths:** `server/src/vendor/shared/adapters.ts` (additive interface extension), `client/src/vendor/shared/adapters.ts` (mirrored additive interface extension — same two method signatures, kept structurally identical to the server copy per the established two-copies convention even though no client code calls them directly), `server/src/adapters/github/octokit.ts` (implement the two new methods), `server/src/adapters/mocks.ts` (extend the mock `GitHubClient` implementation used by hermetic tests)

**What to do:**
1. In `server/src/vendor/shared/adapters.ts`, extend the `GitHubClient` interface (additive — do not touch any existing method signature) with two new methods:
   - `getRepoTree(repo: RepoRef, ref?: string): Promise<{ path: string; type: 'blob' | 'tree' }[]>` — wraps `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` (Octokit: `octokit.rest.git.getTree`). When `ref` is omitted, resolve the default branch's tree sha first (or pass `ref` directly if the caller already has the default branch name — Octokit's `getTree` accepts a branch name as `tree_sha` for the recursive listing in practice via the repo's default ref; if not, resolve `owner/repo` → default branch → `git/refs/heads/{branch}` → commit sha → tree sha, in that order, and cache nothing — single call site).
   - `getFileContents(repo: RepoRef, path: string, ref?: string): Promise<string | null>` — wraps `GET /repos/{owner}/{repo}/contents/{path}` (Octokit: `octokit.rest.repos.getContent`), base64-decodes the `content` field, returns `null` on 404 (file not present — NOT an error, e.g. no README) rather than throwing.
2. Apply the IDENTICAL two method signatures to `client/src/vendor/shared/adapters.ts`'s copy of the `GitHubClient` interface — this keeps the two ports byte-for-byte structurally identical, consistent with how `client/insights.md` (2026-06-30) documents the contracts copies must move together. No client runtime code constructs or calls a `GitHubClient` (that only happens server-side), so this is a type-only mirror with zero behavior — but it is still required for the two copies not to silently diverge.
3. In `server/src/adapters/github/octokit.ts`, implement both methods on `OctokitGitHubClient` using the same `withRetry(() => withTimeout(...))` wrapping convention as every other method in the file. `getFileContents` catches a 404 Octokit error specifically and returns `null`; any other error propagates (consistent with the rest of the file's error philosophy — only the documented "absent" case is swallowed).
4. In `server/src/adapters/mocks.ts`, add both methods to the mock `GitHubClient` implementation with simple deterministic fixture behavior (e.g. a small hardcoded tree + a fixture `package.json`/`README.md` content map) so hermetic tests in Step 6 can exercise lite mode without a real GitHub call.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck` AND `cd client && pnpm typecheck` — both adapter-port copies)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes (existing adapter/mock tests unaffected — this is purely additive)
- [ ] No existing `GitHubClient` call site anywhere in the codebase needed a signature change (grep confirms only additive)
- [ ] `server/src/vendor/shared/adapters.ts` and `client/src/vendor/shared/adapters.ts` diffs are structurally identical for the `GitHubClient` interface section

**Commit:** `feat(github-adapter): add getRepoTree and getFileContents for onboarding lite mode (server + client port mirror)`

---

### Step 4: Shared `onboarding-tour` contracts (both vendor/shared copies, non-colliding names)

**Dependencies:** none
**Owned paths:** `server/src/vendor/shared/contracts/onboarding-tour.ts` (new), `server/src/vendor/shared/index.ts` (add barrel export), `client/src/vendor/shared/contracts/onboarding-tour.ts` (new, mirrored), `client/src/vendor/shared/index.ts` (add barrel export, if the client barrel mirrors the server one — verify the existing pattern for e.g. `blast.ts` before assuming)

**What to do:**
1. First, CONFIRM (do not re-derive — this was already verified during planning) that `server/src/vendor/shared/contracts/knowledge.ts:29-47` defines `OnboardingLink`, `OnboardingSection`, `Onboarding` and that both are barrel-exported. Do NOT edit, rename, or remove any of these three. This step's new file uses entirely different names for the same conceptual space, chosen specifically to avoid the `TS2308` duplicate-export collision a staff review already caught in the first draft of this plan.
2. Author `onboarding-tour.ts` in `server/src/vendor/shared/contracts/` translating spec §17's Contracts section into Zod schemas, using ONLY these new names:
   - `OnboardingTourRunMetadata` — REUSE the exact shape of `BlastIndexInfo` (`status: enum(['full','partial','degraded','failed']), degraded: boolean, reason: string.nullish()`), PLUS `mode: z.enum(['full','lite'])` and `llm_cost_cents: number.int().nonnegative().nullable()` folded in (this single object carries all of §17's "index-health + mode + cost" metadata together, avoiding a proliferation of tiny top-level fields on `OnboardingTour`). Either import/re-export `BlastIndexInfo`'s shape directly if a cross-file import within `vendor/shared` is idiomatic here (check how `blast.ts` imports `BlastRadius`/`PrHistory` from `brief.ts` — same package, same convention applies), or define a structurally identical inline shape if reuse would create a circular import.
   - `OnboardingTourLink` — `{ label: string, path: string, github_url: string.url().nullable() }` (the resolved GitHub blob URL, null when unresolvable per AC-9 — named distinctly from the pre-existing `OnboardingLink` in `knowledge.ts`, which has no `github_url` field and is a different shape).
   - `OnboardingTourEntry` (used for Critical Paths / Reading Path rows) — `{ path: string, rationale: string, rank: number.nullable(), github_link: string.url().nullable() }` (rank null in lite mode per §17; github_link null when unresolvable per AC-9).
   - `OnboardingTourTask` (used for First Tasks cards) — `{ title: string, target_path: string, complexity: z.enum(['low', 'medium', 'high']) }`.
   - `OnboardingTourSectionKind` — `z.enum(['architecture', 'critical_paths', 'how_to_run', 'reading_path', 'first_tasks'])` — this is the AUTHORITATIVE list; it drives both the DB/API contract here and the system-prompt edit in Step 6 (which must emit exactly these five, no more, no fewer).
   - `OnboardingTourSection` — `{ kind: OnboardingTourSectionKind, title: string, body: string, diagram: string.nullable(), entries: z.array(OnboardingTourEntry), tasks: z.array(OnboardingTourTask), links: z.array(OnboardingTourLink) }` — `entries`/`tasks`/`links` are alternate per-kind payload shapes; a given section populates only the array(s) relevant to its `kind` (e.g. `first_tasks` populates `tasks`, leaves `entries`/`links` empty) — document this discriminated-by-convention (not a discriminated union, to keep the shape simple and match how `BlastResponse` already handles similarly-shaped optional per-kind data).
   - `OnboardingTour` — `{ repo_id: string.uuid(), generated_at: string.datetime().nullable() /* null = never generated */, run: OnboardingTourRunMetadata, sections: z.array(OnboardingTourSection).length(5) }`.
   - `OnboardingTourGenerateResponse` — same shape as `OnboardingTour` (the generate endpoint returns the refreshed tour synchronously per spec §7's stated option — see Step 6 for the sync-vs-async decision).
   - Export both the Zod schemas and their `z.infer` types per the zod skill's `type-export-schemas-and-types` rule.
3. Add the barrel export line to `server/src/vendor/shared/index.ts` (one line, following the existing pattern for `blast.ts`/other contract files).
4. Copy the exact same file content to `client/src/vendor/shared/contracts/onboarding-tour.ts` (byte-identical schemas — this is a deliberate manual sync per the existing two-copies convention, not a shared import). Add the matching barrel export to `client/src/vendor/shared/index.ts`.
5. Grep the WHOLE `vendor/shared` directory (both copies) for every new export name (`OnboardingTour`, `OnboardingTourSection`, `OnboardingTourSectionKind`, `OnboardingTourEntry`, `OnboardingTourLink`, `OnboardingTourTask`, `OnboardingTourRunMetadata`, `OnboardingTourGenerateResponse`) before finalizing, AND separately confirm none of them match the pre-existing `OnboardingLink`/`OnboardingSection`/`Onboarding` names — per `server/insights.md` 2026-07-02 Mistake entry, a duplicate export name across contract files breaks the barrel with a cryptic `TS2308` error at `index.ts`, not at the colliding file.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck` AND `cd client && pnpm typecheck` — both copies must typecheck independently)
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — existing `contracts.test.ts` (if it parses the whole barrel) still passes
- [ ] No duplicate export names across either `vendor/shared` copy, AND no name collides with the pre-existing `knowledge.ts` `Onboarding*` exports
- [ ] The pre-existing `OnboardingLink`/`OnboardingSection`/`Onboarding` exports in `knowledge.ts` are byte-for-byte unchanged (diff confirms zero edits to that file)
- [ ] Both new-file copies are byte-identical (diff check)

**Commit:** `feat(shared): add OnboardingTour contracts (server + client vendor/shared, non-colliding names)`

---

### Step 5: repo-intel repo-wide `file_facts` aggregator (routes/endpoints inventory)

**Dependencies:** none (can start in Wave 1 alongside Steps 1–4; grouped in Wave 2 narrative only because Step 6 needs it)
**Owned paths:** `server/src/modules/repo-intel/repository.ts` (add method), `server/src/modules/repo-intel/service.ts` (add facade method), `server/src/modules/repo-intel/types.ts` (extend `RepoIntel` interface)

**What to do:**
1. In `RepoIntelRepository` (`repository.ts`), add `getAllFileFacts(repoId: string): Promise<IndexerFileFactsRow[]>` — same shape/query as the existing `getFileFacts(repoId, files)` (around line 548) but WITHOUT the `files` filter — select all `file_facts` rows for `repoId`. This is the "new repo-wide route aggregator over file_facts" named in the requirements. It is intentionally UNCAPPED at this layer — it is a general-purpose aggregation read, not LLM input; capping happens exclusively in `buildLlmInput` (Step 6) per §4's bounded-input rule.
2. In `types.ts`, add `getAllFileFacts(repoId: string): Promise<{ filePath: string; endpoints: string[]; crons: string[] }[]>` to the `RepoIntel` interface (array-returning method — degrades to `[]` per the file's documented DEGRADED CONTRACT, never throws).
3. In `RepoIntelService` (`service.ts`), implement `getAllFileFacts`: gate on `this.container.config.repoIntelEnabled` (matching every other facade read method's degraded-gate convention), delegate to `this.repo.getAllFileFacts(repoId)`.
4. This method deliberately does NOT apply the `HUB_ENDPOINT_LIMIT` filtering that `blast/service.ts` applies (that filter is specific to blast's "don't attribute a whole app's routes to one changed symbol" concern) — onboarding's routes/endpoints section wants the COMPLETE inventory at the aggregation layer, hub files included, since it's describing "what routes exist in this repo," not attributing impact to a symbol. The LLM-input-side capping (`LLM_INPUT_MAX_ENDPOINTS`, `LLM_INPUT_MAX_ROUTES_PER_FILE` from §4) is applied downstream in `buildLlmInput`, not here. Document this distinction in a code comment referencing both `blast/service.ts`'s `HUB_ENDPOINT_LIMIT` and `onboarding/helpers.ts`'s `buildLlmInput` caps so a future reader doesn't "fix" this by importing one filter into the wrong layer.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` — new hermetic test: `getAllFileFacts` returns all rows for a repo with no file-list filter (including a fixture with >100 rows, proving no implicit cap at this layer), returns `[]` for a repo with no indexed facts, returns `[]` when `repoIntelEnabled` is false
- [ ] No existing caller of `getFileFacts` (the filtered version) was touched — this is a strictly additive new method

**Commit:** `feat(repo-intel): add getAllFileFacts repo-wide aggregator for onboarding routes inventory`

---

### Step 6: Onboarding server module (routes / service / repository / helpers) + system prompt edit

**Dependencies:** Step 1 (migration + schema columns), Step 3 (GitHub Trees/Contents adapter), Step 4 (shared contracts), Step 5 (file_facts aggregator)
**Owned paths:** `server/src/modules/onboarding/routes.ts` (new), `server/src/modules/onboarding/service.ts` (new), `server/src/modules/onboarding/repository.ts` (new), `server/src/modules/onboarding/helpers.ts` (new), `server/src/modules/onboarding/constants.ts` (new), `server/src/modules/index.ts` (add one import + one registry entry), `server/src/prompts/onboarding.system.md` (edit — exact changes below), `server/test/onboarding-*.test.ts` (new hermetic tests)

**What to do:**

1. **`server/src/prompts/onboarding.system.md` — required edits (exact):**
   - Replace the line `Produce EXACTLY these sections, in this order:\n{{sections}}` — keep the `{{sections}}` template variable, but the VALUE it is populated with at render time (from `constants.ts` in this module, see below) must be exactly this 5-item list, one per line, matching `OnboardingTourSectionKind` from Step 4 verbatim:
     ```
     architecture
     critical_paths
     how_to_run
     reading_path
     first_tasks
     ```
     The prompt's current draft language references a `routes_and_apis` section (see the "In `routes_and_apis`: present grouped bullet lists..." formatting-rules paragraph) — **REMOVE this section entirely from the prompt** (both the mention in the section-kind guidance and its formatting-rules paragraph). `routes_and_apis` is NOT one of the spec's 5 fixed sections (spec §5: Architecture overview, Critical paths, How to run locally, Guided reading path, First tasks) — routes/endpoint inventory data instead feeds the `architecture` section's narrative and `buildLlmInput`'s fact bundle, it does not get its own top-level section.
   - The diagram-allow-list line currently reads "an optional mermaid `diagram` (allowed ONLY for the `architecture` and `routes_and_apis` sections, else null)". Change to **"allowed ONLY for the `architecture` and `how_to_run` sections, else null"** — this matches the spec exactly (§5: diagram on Architecture overview; §5 "How to run locally" is a numbered command list, but the workflow diagram in Architecture already covers layers/modules — re-reading spec §5 closely: only `architecture` has a diagram requirement stated ("a small boxed architecture diagram") — **the corrected rule is: diagram allowed ONLY for `architecture`, `null` for all four other sections including `how_to_run`.** Implementers: use this corrected single-section rule (architecture only), not the two-section rule from the earlier draft of this fix — the earlier draft over-corrected; the spec's §5 diagram requirement is explicitly scoped to Architecture overview only.
   - Remove the generic "up to 4 `links` ({label, path}) pointing at REAL files" cap that currently applies uniformly to every section. The Guided reading path section's entries (spec §5: "a numbered, ordered list of files... order follows computed importance rank") must NOT be capped at 4 by the prompt — its length is determined by `LLM_INPUT_TOP_N_FILES` (20, from §4) on the input side, and the prompt must allow the LLM to emit a rationale for EACH of the ranked entries it was given, not silently truncate to 4. Reword the links guidance to: "For `critical_paths` and `first_tasks`, include up to 4 illustrative links. For `reading_path`, emit one entry per ranked file provided in the input — do not truncate." (`architecture`/`how_to_run` keep whatever link guidance already exists, unaffected by this fix.)
   - Define every template variable the prompt references. Currently only `{{sections}}` and `{{language}}` are used. Confirm (grep the file) there are no other `{{...}}` placeholders; if any are found beyond these two, they must be defined here in the plan and populated by `constants.ts`/`service.ts` at render time. As of this plan: `{{sections}}` = the 5-line list above (verbatim, one kind-slug per line); `{{language}}` = `"English"` (this feature has no locale-selection UI in v1 — narrative is always generated in English regardless of the workspace's client-side next-intl locale; UI chrome strings are separately translated via next-intl in Step 7, but LLM-GENERATED narrative content itself is English-only for v1, consistent with the rest of the codebase's LLM-authored content such as PR briefs and conventions).
   - After these edits, the prompt's "Grounding rules," "Formatting," "Mermaid rules," "Output format," and "SECURITY" sections are otherwise unchanged from the existing file (they were already correct/reusable).

2. **`repository.ts`** — `OnboardingRepository`, constructor takes `Db`. Methods, ALL joined through `repos` for workspace scope (no `workspace_id` column on `onboarding` itself — see §4), with ownership enforced MECHANICALLY inside every query (resolves a non-blocking review finding — do not rely on the service having "already checked" before calling `upsertTour`):
   - `getTour(workspaceId: string, repoId: string): Promise<OnboardingRow | null>` — `SELECT onboarding.* FROM onboarding INNER JOIN repos ON onboarding.repo_id = repos.id WHERE onboarding.repo_id = $repoId AND repos.workspace_id = $workspaceId`.
   - `upsertTour(workspaceId: string, repoId: string, data: {...}): Promise<OnboardingRow>` — the workspace check is IN THE WRITE PATH ITSELF, not a precondition the caller must remember to satisfy: wrap the upsert in a single statement/transaction that first re-validates `EXISTS (SELECT 1 FROM repos WHERE id = $repoId AND workspace_id = $workspaceId)` (e.g. via a CTE or a guarded `INSERT ... SELECT ... WHERE EXISTS(...)` pattern, or a Drizzle transaction doing the existence check then the `ON CONFLICT` upsert inside the same `tx`) — if the repo does not belong to the workspace, the write affects zero rows and the method returns `null`/throws `NotFoundError` (caller's choice of signature, but the DB query is what enforces it, not caller discipline). Then, when ownership holds: `INSERT ... ON CONFLICT (repo_id) DO UPDATE SET json=excluded.json, generated_at=excluded.generated_at, mode=excluded.mode, index_status=excluded.index_status, degraded=excluded.degraded, degraded_reason=excluded.degraded_reason, llm_cost_cents=excluded.llm_cost_cents`.
   - `getRepoBasics(repoId: string): Promise<{ owner, name, defaultBranch, clonePath, workspaceId } | null>` — mirrors `BlastRepository.getRepoBasics` / `RepoIntelRepository.getRepoBasics`, returns `workspaceId` so the SERVICE can short-circuit early with a friendly 404 before doing any expensive fact-gathering — but this is an optimization/UX nicety, NOT the security boundary; the security boundary is `upsertTour`'s own `EXISTS` check per the point above.

3. **`helpers.ts`** — pure functions:
   - `toOnboardingTourDto(row, sections)`: maps a DB row + generated sections array into the `OnboardingTour` contract shape (never-null generation timestamp handling: `generated_at: row ? row.generatedAt.toISOString() : null`).
   - `buildLlmInput(facts)`: assembles the BOUNDED fact bundle passed to the LLM — enforces every cap from §4:
     - top-N ranked files, hard-capped at `LLM_INPUT_TOP_N_FILES` (20)
     - aggregated route/endpoint facts (from Step 5's `getAllFileFacts`), deduplicated then capped at `LLM_INPUT_MAX_ENDPOINTS` (60) total, with any single file's contribution capped at `LLM_INPUT_MAX_ROUTES_PER_FILE` (10) BEFORE the global cap is applied (so one hub file cannot itself consume the whole 60-endpoint budget)
     - critical-path chains (from `getCriticalPaths`, already capped at 5 roots × `BFS_DEPTH` internally — no further capping needed here)
     - stack/script facts (from `package.json`) and any lite-mode README excerpt, included as-is (these are already small/bounded by nature — a `package.json` `scripts` block and a README are not unbounded lists)
     - a final `LLM_INPUT_MAX_BYTES` (40,000) ceiling on the assembled input STRING — if the naturally-capped bundle still exceeds this (e.g. an unusually large `package.json` or README), truncate whole sections in priority order: routes list first, then critical-path chains, then per-file one-line summaries — NEVER mid-entry (no half a route string, no half a file path)
     - NEVER full file contents — only paths, one-line facts, and aggregate counts
   - `appendDiagramColors(diagram: string, sectionKind): string`: deterministically appends a `classDef`/`style` block to the LLM-returned mermaid string, keyed by node-kind detected via the reused Blast-Graph-style category convention (application code / middleware / datastore) — see §3. If `diagram` is null, return null unchanged (never synthesize a diagram the LLM didn't produce). Per the corrected prompt rule (item 1 above), this only ever fires for the `architecture` section in practice.
   - `mapGithubLink(repoBasics, sha, path)`: build a `github_link` exactly like `BlastLink`-consuming client code does (`https://github.com/{owner}/{repo}/blob/{sha}/{path}`), returning `null` when `repoBasics` or `sha` is unavailable (AC-9).
   - `attachRankOrder(rankedPaths, llmRationaleByPath)`: THIS is where AC-7's ordering invariant is mechanically enforced — takes the server-computed `getTopFilesByRank` result (already rank-DESCENDING) as the master order, looks up each entry's rationale text from the LLM's response by path, and emits the final `OnboardingTourEntry[]` in the SERVER's order. If the LLM omitted a rationale for some ranked path (should be rare given the bounded input includes exactly the ranked set), fall back to a deterministic placeholder rationale (e.g. derived from the file's role in the import graph) rather than dropping the entry or re-ordering around the gap. The LLM's own ordering of its response array, if any, is discarded — only its per-path rationale TEXT is consumed.

4. **`constants.ts`**:
   - `LLM_INPUT_TOP_N_FILES = 20`
   - `LLM_INPUT_MAX_ENDPOINTS = 60`
   - `LLM_INPUT_MAX_ROUTES_PER_FILE = 10`
   - `LLM_INPUT_MAX_BYTES = 40_000`
   - `ONBOARDING_SECTION_KINDS = ['architecture', 'critical_paths', 'how_to_run', 'reading_path', 'first_tasks'] as const` — the single source of truth rendered into the edited prompt's `{{sections}}` slot (Item 1 above); import this constant wherever the prompt is rendered so the prompt text and the Zod `OnboardingTourSectionKind` enum (Step 4) can never drift apart.
   - `ONBOARDING_PROMPT_LANGUAGE = 'English'` — the `{{language}}` template value (Item 1 above).
   - `ONBOARDING_RATE_LIMIT = { max: 3, timeWindow: '1 minute' } as const`
   - `ONBOARDING_SYSTEM_PROMPT_PATH` reference (reuse `platform/prompts.ts`'s existing template loader for `onboarding.system.md`)
   - The narrower Zod schema passed to `completeStructured` for the 5-section narrative-only output (title/body/diagram/per-entry-rationale-keyed-by-path per section — the LLM does NOT emit `rank`, final entry ORDER, `github_link` resolution, or index-health metadata; those are assembled/enforced deterministically by the service after the LLM call, per AC-4/AC-5/AC-7's zero-LLM-for-facts-and-ordering invariant).

5. **`service.ts`** — `OnboardingService`, constructor takes `Container`:
   - `async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour>`: fetch via repository; if no row, return the "never generated" well-formed response (spec §7 — `generated_at: null`, 5 sections present with empty bodies, `run.mode`/`run` reflecting a fresh `getIndexState` call so the UI can still show a degraded/lite badge and CTA even pre-generation). Never throws for "not yet generated" — that is a valid response shape (only a genuinely missing/cross-workspace REPO throws `NotFoundError`).
   - `async generateTour(workspaceId: string, repoId: string): Promise<OnboardingTour>`: this is the single orchestration method — the heart of the feature:
     a. Resolve repo basics (throw `NotFoundError` if repo missing/cross-workspace) — this is the UX-early-exit check; the write path's own `EXISTS` guard (repository.ts, item 2 above) is the actual security boundary and fires again regardless.
     b. Call `container.repoIntel.getIndexState(repoId)` to decide full vs lite mode (full/partial → attempt full-mode facts; degraded/failed with no clone → lite mode per AC-10).
     c. **Full mode**: `getTopFilesByRank` (this IS the master rank order per AC-7 — capture it before anything else), `getCriticalPaths`, `getAllFileFacts` (Step 5), plus direct clone reads of `package.json`/`.env.example`/docker-compose via `container.git.readFile` (reusing the `context-docs` module's confined-path pattern documented in `server/insights.md` 2026-07-03 — repo-relative path passed to `readFile`, never an absolute confined path).
     d. **Lite mode**: `container.github().getRepoTree()` + `getFileContents()` for `package.json` and `README.md` (Step 3); reading-path built from the documented heuristic (declared entry points + top-level dirs) — explicitly NOT rank-ordered (no import graph available), tagged accordingly in the response (`rank: null` per entry).
     e. **No-data fallback** (AC-12): if full mode is unavailable AND the lite-mode GitHub calls also fail/return nothing usable, build a deterministic skeleton — 5 section headers, empty bodies, honest "not enough data" notices, `run.status = 'failed'` — and skip the LLM call entirely (this is the one case where generation completes with ZERO sections having narrative content and the LLM is never invoked; still counts as "a generation attempt was made" for UI purposes, but AC-5's "one LLM call" invariant is satisfied vacuously — zero is not more than one).
     f. Build the BOUNDED fact bundle (`helpers.buildLlmInput` — enforces all §4 caps), resolve the feature model (`resolveFeatureModel(container, workspaceId, 'onboarding')`), make the ONE `completeStructured` call using the EDITED `onboarding.system.md` template (loaded via `platform/prompts.ts`'s existing loader, rendered with `{{sections}}` = `ONBOARDING_SECTION_KINDS` and `{{language}}` = `ONBOARDING_PROMPT_LANGUAGE` from `constants.ts`) with README/repo-content wrapped in `<untrusted>` tags per §18.
     g. Post-process: `appendDiagramColors` on the `architecture` section's diagram only (per the corrected prompt rule); attach `github_link` per entry via `mapGithubLink`; build the FINAL reading-path entry order via `attachRankOrder` using step-c's server-computed rank list as the master order and the LLM's per-path rationale text as the only thing consumed from the LLM's response for that section (AC-7 mechanism, mirrored into `helpers.ts` item 3 above).
     h. Compute `llm_cost_cents = result.costUsd != null ? Math.round(result.costUsd * 100) : null`.
     i. Log exactly one structured line: LLM call made, cost in cents, mode, index status (AC-6, §13) — `req.log`-style child logger passed down from the route (mirrors the `run-executor.ts` fire-and-forget logger pattern from `server/insights.md`).
     j. Persist via `repository.upsertTour(...)`; return the fresh `OnboardingTour`.
     k. On any hard failure during full generation AFTER a previously-persisted tour exists (AC-18): catch, log, and re-throw an `AppError` that the ROUTE layer maps to a retryable error response WITHOUT touching the persisted row — the client (Step 7) is responsible for keeping the last-good tour visible; the service must NOT overwrite `onboarding` on a failed generation.
   - Non-fatal, best-effort framing throughout: EVERY external read in full/lite mode is wrapped so a single failing fact source (e.g. no `.env.example` present, or `docker-compose.yml` absent) degrades that fact silently rather than aborting the whole generation — only a total inability to gather ANY usable facts triggers the AC-12 skeleton path.

6. **`routes.ts`**:
   - `GET /repos/:id/onboarding` → `service.getTour(workspaceId, repoId)`. Schema: `params: IdParams`, `response: { 200: OnboardingTour }`.
   - `POST /repos/:id/onboarding/generate` → `service.generateTour(workspaceId, repoId)`, rate-limited via `ONBOARDING_RATE_LIMIT` from `constants.ts` (`{ max: 3, timeWindow: '1 minute' }`) PLUS a custom `keyGenerator`:
     ```typescript
     config: {
       rateLimit: {
         ...ONBOARDING_RATE_LIMIT,
         keyGenerator: async (req) => {
           const { workspaceId } = await getContext(container, req);
           return `onboarding-generate:${workspaceId}`;
         },
       },
     },
     ```
     This resolves the non-blocking review finding on `keyGenerator` — the default `@fastify/rate-limit` key is the client IP, which does not implement "per-workspace" and is wrong behind any shared dev tunnel/proxy. The `keyGenerator` calls `getContext` itself (Fastify calls `keyGenerator` before the handler body runs); the handler ALSO calls `getContext` for its own `workspaceId` — this is two calls to `container.auth.currentWorkspace()` per request, which is acceptable given `LocalNoAuthProvider`'s trivial cost, but is called out here explicitly rather than silently duplicated. If profiling later shows this matters, `req` can be decorated with the resolved context in an `onRequest` hook — out of scope for this plan.
   - Pass a child logger (`req.log.child({ route: 'onboarding.generate', repoId })`) into the service call per the fire-and-forget logger convention — even though this route is NOT fire-and-forget (spec §7 allows either sync-return or async-poll; this plan chooses **synchronous return of the refreshed tour** since generation is a single bounded LLM call, not a fan-out, so there is no strong reason to add polling complexity) so the logger recycling risk does not actually apply here, but the child-logger pattern is used anyway for consistent structured log correlation.
   - Both routes call `getContext(container, req)` first, exactly like every other module.

7. **`modules/index.ts`**: add `import onboarding from './onboarding/routes.js';` and one entry `onboarding,` in the `modules` registry object.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` — hermetic tests (see Testing Plan for the full AC-derived list) pass, using `MockLLMProvider`/mocked `GitHubClient`/mocked `repoIntel` from `src/adapters/mocks.ts` and `ContainerOverrides`
- [ ] Cross-workspace `upsertTour` call (repo belongs to a different workspace) writes zero rows and the method surfaces this as `null`/`NotFoundError` — asserted directly against the repository, not just through the service (proves the mechanical DB-level guard, not just service-level discipline)
- [ ] Cross-workspace request to `GET /repos/:id/onboarding` for a repo in a different workspace returns 404, not the tour (workspace isolation)
- [ ] A generation on a repo with NO clone and a failing GitHub API returns the AC-12 skeleton, not a 500
- [ ] Exactly one `completeStructured` call is made per successful `generateTour` invocation (assert call count on the mock LLM provider)
- [ ] A large-repo fixture (fabricate >200 `file_facts` rows and >30 ranked files) proves `buildLlmInput`'s assembled string stays under `LLM_INPUT_MAX_BYTES` and the endpoint count stays ≤ `LLM_INPUT_MAX_ENDPOINTS` — asserted directly on the bundle passed to the mock LLM provider's `completeStructured` call, not just on the final response
- [ ] Reading-path response order matches the server-computed `getTopFilesByRank` order exactly, using a fixture where that order is NOT alphabetical and the mock LLM deliberately returns rationale entries in a DIFFERENT (e.g. reversed or alphabetical) order — proves `attachRankOrder` overrides the LLM's ordering rather than trusting it
- [ ] The registered route's `rateLimit` config (static inspection, not a live 429) shows `{ max: 3, timeWindow: '1 minute' }` and a defined `keyGenerator`
- [ ] The rendered prompt (assert on the string passed to `completeStructured`'s `messages`) contains exactly the 5-item section list from `ONBOARDING_SECTION_KINDS`, does NOT contain the string `routes_and_apis`, and does NOT contain a "4 links" cap phrase for the reading-path guidance

**Commit:** `feat(onboarding): add onboarding server module (full+lite generation, bounded LLM input, server-owned ranking, per-workspace rate limiting)`

---

### Step 7: Onboarding client page, components, hooks, nav fix, and i18n reconciliation

**Dependencies:** Step 4 (shared contracts) only — proceeds in parallel with Step 6 against mocked API responses
**Owned paths:** `client/src/app/repos/[repoId]/onboarding-tour/page.tsx` (new), `client/src/app/repos/[repoId]/onboarding-tour/_components/**` (new — `OnboardingTourView`, `ArchitectureSection`, `CriticalPathsSection`, `HowToRunSection`, `ReadingPathSection`, `FirstTasksSection`, shared `SectionCard` chrome, `LiteBadge`/`DegradedBadge`), `client/src/lib/hooks/onboarding.ts` (new), `client/src/vendor/ui/nav.ts` (add one `NavItemDef` entry), `client/src/components/app-shell/helpers.ts` (fix `activeKeyFor`), `client/messages/en/onboarding.json` (reconcile — edit in place, do not overwrite wholesale)

**What to do:**
1. **`page.tsx`** — async Server Component, `await params`, hands `repoId` to a client view component. Mirrors `context/page.tsx` exactly (per `client/insights.md` 2026-07-03 Decision — this is the correct, if unusual-in-this-codebase, pattern to follow for NEW pages).
2. **`nav.ts`** — add `{ key: "onboarding-tour", label: "Onboarding Tour", icon: <pick an existing IconName, e.g. "BookOpen" or "Compass" — verify it exists in `vendor/ui/icons.tsx` before using>, href: "/repos/:repoId/onboarding-tour", gKey: "o" }` under the `WORKSPACE` section, positioned BETWEEN `pulls` and `context` per spec §5 ("between 'Pull Requests' and 'Project Context'"). Also add the matching entry to `SHORTCUTS` (`{ keys: "g o", label: "Go to Onboarding Tour", group: "Navigation" }`).
3. **`client/src/components/app-shell/helpers.ts` — fix `activeKeyFor` (resolves a non-blocking review finding):**
   `activeKeyFor` ALREADY contains a line `if (pathname.includes("/onboarding")) return "onboarding-tour";` (line 29) — this was added ahead of this plan but is a BUG as written: `.includes("/onboarding")` matches BOTH `/repos/:repoId/onboarding-tour` (this feature) AND the pre-existing, unrelated `/onboarding` add-repo route (`client/src/app/onboarding/page.tsx`), incorrectly highlighting "Onboarding Tour" in the sidebar while the user is on the Add Repo page. Fix by making the check specific to the new route's actual path shape: replace the existing line with `if (pathname.includes("/onboarding-tour")) return "onboarding-tour";` — this matches only the new repo-scoped route and does NOT match the bare `/onboarding` add-repo path (which has no `-tour` suffix). Verify no other branch in this function's if-chain would now incorrectly also match `/onboarding-tour` (checked: `/context`, `/conventions`, `/pulls` etc. are all distinct substrings, no collision).
4. **`client/messages/en/onboarding.json` — reconcile, do not replace (resolves a non-blocking review finding):**
   This file ALREADY EXISTS with keys for a DIFFERENT section list (`"body": "...writes a 5-section guided tour: overview, architecture, key modules, getting started, and conventions & gotchas."` — five sections, but NOT the same five as this spec's `architecture / critical_paths / how_to_run / reading_path / first_tasks`). Do not delete or wholesale-replace this file. Instead:
   - Keep the existing top-level keys (`title`, `sections`, `sectionCount`, `regenerate`, `regenerating`, `unknownError`, `generate.*`, `loadError.*`) as-is where their semantics still apply generically (e.g. `title: "Onboarding Tour"`, `regenerate: "Regenerate"` are correct regardless of which 5 sections exist).
   - UPDATE `generate.body`'s section-list description to match the ACTUAL 5 sections this plan implements: `"DevDigest indexes the repo, then writes a 5-section guided tour: architecture overview, critical paths, how to run locally, guided reading path, and first tasks."` — this is the one string that describes the old, now-incorrect section list and must change to avoid shipping stale copy.
   - ADD new keys this plan's components need and the existing file does not yet have: per-section titles (`sections.architecture`, `sections.criticalPaths`, `sections.howToRun`, `sections.readingPath`, `sections.firstTasks`), the "Clone & index for full tour" CTA string, "Share link" action label, the lite/degraded badge label + reason strings (reuse the same key SHAPE as the existing `blast` namespace's `degraded.*` keys for consistency, e.g. `degraded.badge`, `degraded.partial`, `degraded.noIndex`), complexity badge labels (`complexity.low`, `complexity.medium`, `complexity.high`), and the AC-18 inline error/retry strings.
   - Before adding any new key, grep the file for a key that might already serve the same purpose (the file was clearly authored ahead of this plan with SOME foresight — e.g. it already has `regenerating`/`unknownError`/`loadError.title`) — reuse rather than duplicate.
5. **`hooks/onboarding.ts`**:
   - `useOnboardingTour(repoId)`: `useQuery({ queryKey: ["onboarding", repoId], queryFn: () => api.get<OnboardingTour>(`/repos/${repoId}/onboarding`), enabled: !!repoId, staleTime: 5 * 60 * 1000 })` — mirrors `useBlast`.
   - `useGenerateOnboardingTour(repoId)`: `useMutation` wrapping `api.post<OnboardingTour>(`/repos/${repoId}/onboarding/generate`)`, invalidating/`setQueryData`-updating the `["onboarding", repoId]` cache key on success so the page re-renders with the fresh tour without a second fetch round-trip. On a 429 (rate-limited) response, surface a distinct "please wait" message rather than the generic error path (the mutation's `onError` can branch on `ApiError.status === 429`).
6. **`OnboardingTourView.tsx`** (container component — fetches, owns loading/error/empty branching per react-best-practices):
   - Header: title "Onboarding for `<repo>`" (repo name in accent color via existing typographic convention — check `PrDetailHeader` for the accent-color pattern already used for repo/PR titles), subtitle "Generated from index of N files · last refreshed `<time>` ago" (compute relative time client-side from `generated_at`; N files = index state's `filesIndexed` if surfaced on `run`/`OnboardingTourRunMetadata` — if not present on the contract, omit the N-files clause gracefully rather than adding scope to Step 4's contract; render "Generated from repository index" as a fallback string when the count isn't available).
   - Two top-right actions: "Regenerate" (calls `useGenerateOnboardingTour().mutate()`, disabled/spinner while pending) and "Share link" (copies `window.location.href` to clipboard via `navigator.clipboard.writeText` — AC-15, no new API call).
   - "ON THIS PAGE" table of contents — static list of the 5 section titles in fixed order (`ONBOARDING_SECTION_KINDS`-equivalent ordering, sourced from the response's `sections` array order, which the server guarantees matches the fixed kind order), anchor-linking to each `SectionCard`.
   - Empty/lite/degraded state handling: when `data.generated_at === null` (never generated) AND no clone/index exists, render section skeletons + a prominent "Clone & index for full tour" CTA button that calls the EXISTING `POST /repos/:id/resync` endpoint (already implemented — `repo-intel/routes.ts`, reused here, NOT a new endpoint) — satisfies AC-10 without inventing new API surface.
   - Loading-in-progress state: while `useGenerateOnboardingTour` mutation is pending, keep rendering the PREVIOUSLY loaded `data` from `useOnboardingTour`'s cache (React Query naturally keeps stale data visible during a separate mutation — no extra state needed) plus a small non-blocking in-progress indicator near the Regenerate button (spec §6 loading state — AC is satisfied by NOT clearing the query cache during the mutation, which is the default TanStack Query behavior as long as the component doesn't manually null out state).
   - Error state (AC-18): on `useGenerateOnboardingTour` mutation error, keep the last successful `useOnboardingTour` data rendered (again, default behavior — the query cache is untouched by a failed mutation) and show an inline error banner with a "Retry" button that re-invokes `mutate()`.
7. **Section components** — each receives its slice of `OnboardingTourSection` + shared props (`link` info for blob URLs, `degraded`/`mode` flags for section-level "based on limited data" framing in lite mode per §8):
   - `ArchitectureSection`: renders `body` as markdown (reuse whatever markdown renderer the project already uses — check `IntentCard.tsx`/`VerdictBanner` for an existing markdown-rendering dependency before adding a new one) + the `diagram` field rendered via the project's existing mermaid-rendering approach if one exists, else a fenced code block fallback (verify: grep for any existing mermaid client renderer before assuming one needs to be added — if none exists, rendering as a labeled `<pre>` block with the raw mermaid source is an acceptable v1 fallback, NOT a blocker for this plan, and should be called out as a follow-up rather than scope-creeping this step). This is the ONLY section that can have a non-null `diagram`, per the corrected prompt rule in Step 6.
   - `CriticalPathsSection`: rows of `path` + `rationale` + "Open" action using `entry.github_link` directly (already resolved server-side, AC-8/AC-9 — render the Open action ONLY when `github_link` is non-null).
   - `HowToRunSection`: numbered list from `entries`, each row rendered as a copyable shell command with a copy-to-clipboard `IconBtn` (reuse the existing copy-to-clipboard pattern — grep for `navigator.clipboard` usage elsewhere in the client for the established micro-pattern, e.g. in `PromptBlock`/`TraceBody`, before writing a new one).
   - `ReadingPathSection`: numbered list ordered exactly as the server returned it (NEVER client-side re-sorted — AC-7 is a server-side invariant enforced by `attachRankOrder` in Step 6; the client must not alphabetize or otherwise reorder `entries`), each with rationale beneath.
   - `FirstTasksSection`: horizontal cards using `OnboardingTourTask` (`title`, `target_path`, `complexity`), complexity badge using the NEW feature-local `COMPLEXITY` token map (Low→`--sugg`, Medium→`--warn`, High→`--crit`, shape mirrors `SEV` from `client/src/vendor/ui/primitives/tokens.ts` but defined locally in this feature's folder, e.g. `_components/OnboardingTourView/constants.ts`, per the promotion rule — do not add to the shared `tokens.ts` for a single consumer).
   - `SectionCard`: shared chrome wrapping every section — header with title + collapse/expand toggle (local `useState`, no persistence needed per spec) + degraded/lite badge reusing the exact `s.degradedBadge` visual pattern from `BlastRadiusCard.tsx` (same CSS-in-JS shape, same `Icon.AlertTriangle`, same `role="status"` accessibility pattern), sourced from `OnboardingTour.run` (the folded index-health + mode + cost metadata object from Step 4).
8. **i18n**: all user-facing strings (section titles, badge labels, CTA text, empty-state copy, error messages) go through `useTranslations()` with keys in the RECONCILED `onboarding` namespace from item 4 above — never hardcoded, per `client/insights.md` 2025-06-01 Mistake entry.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] `cd client && pnpm test` — hermetic Vitest+RTL tests pass with `fetch` mocked (see Testing Plan)
- [ ] No hardcoded English strings — grep the new `_components/` tree for bare string literals in JSX text positions
- [ ] `nav.ts` diff includes the new item (self-check against the documented past mistake of deferring nav wiring)
- [ ] `activeKeyFor` unit/RTL test: a pathname of `/onboarding` (add-repo route) does NOT return `"onboarding-tour"`; a pathname of `/repos/abc/onboarding-tour` DOES return `"onboarding-tour"`
- [ ] `client/messages/en/onboarding.json` diff shows an EDIT (existing keys preserved/updated), not a full-file replacement — confirmed by checking `regenerating`/`unknownError`/`loadError.title` keys still exist unchanged
- [ ] Reading-path order in the rendered DOM matches `entries` array order exactly (no client-side sort)

**Commit:** `feat(onboarding): add Onboarding Tour page, section components, hooks, nav-highlight fix, and i18n reconciliation`

---

### Step 8: Integration closer — wiring verification + manual AC-16/AC-17 walkthrough

**Dependencies:** Step 6 AND Step 7 both complete
**Owned paths:** none exclusively — this step is a verification/small-fixup pass across files already owned by Steps 6/7; any edit here must stay within those already-touched files (no new files)

**What to do:**
1. Run the full server hermetic suite + client test suite together; fix any integration seam issues surfaced only when both sides exist (e.g. a contract field the client expects that the server didn't populate, or vice versa — should be rare given Step 4 was the single source of truth for both).
2. Manually verify (dev server, `./scripts/dev.sh`) the full click path once: navigate via the new sidebar item → see empty/lite state on an unindexed seeded repo → trigger "Clone & index" → after indexing, "Regenerate" → confirm 5 sections render, reading path is rank-ordered, Critical path entries have working GitHub links, degraded badge behavior matches index status, sidebar highlight is correct on both `/onboarding` (add-repo, NOT highlighted as Onboarding Tour) and `/repos/:id/onboarding-tour` (correctly highlighted). This is the manual acceptance run named in AC-17 — document the outcome in the PR description, not in a new file.
3. **AC-16 manual verification (moved here per §4's rate-limit testing constraint)**: with the dev server running normally (rate-limit plugin active — `nodeEnv` is NOT `test` in dev mode), click "Regenerate" 4 times in rapid succession within one minute and confirm the 4th click surfaces the "please wait" rate-limited message from Step 7 item 5, not a 5th LLM call. Document pass/fail alongside the AC-17 walkthrough.
4. Confirm the server log line from Step 6.5.i actually appears with cost-in-cents on a real generation against a seeded repo (AC-6 observability check).
5. Confirm the rendered prompt sent to the LLM (visible via the run trace or a temporary debug log) matches the edited `onboarding.system.md` — specifically that no `routes_and_apis` section appears in the LLM's response and the reading-path section contains more than 4 entries when the seeded repo has more than 4 ranked files (proves the "up to 4 links" cap was correctly scoped away from the reading path).

**Verify:**
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — full suite green
- [ ] `cd client && pnpm test` — full suite green
- [ ] `cd server && pnpm typecheck` && `cd client && pnpm typecheck` — both green
- [ ] Manual AC-17 walkthrough completed against a seeded indexed repo, one LLM call confirmed in logs with cost in cents
- [ ] Manual AC-16 walkthrough completed — 4th rapid Regenerate click within a minute is rejected
- [ ] Manual prompt-shape spot check confirms no `routes_and_apis` section and an uncapped reading-path entry count

**Commit:** `chore(onboarding): integration verification pass` (only if any fixup edits were needed — otherwise no commit, this step is a gate not guaranteed to produce a diff)

---

## 6. Acceptance Criteria — Traceability

| AC | Requirement (summary) | Satisfied by | Test |
|---|---|---|---|
| AC-1 | 5 sections, fixed order | Step 6.4/6.5 (`generateTour` builds exactly 5 sections from `ONBOARDING_SECTION_KINDS`, the single source of truth also rendered into the edited prompt), Step 7.6 (TOC + section render order) | Hermetic: assert `sections.length === 5`, kind order, and rendered prompt contains exactly the 5-item list with no `routes_and_apis`; RTL: TOC renders 5 items in order |
| AC-2 | Persisted tour renders without new generation | Step 6.5.a (`getTour` is read-only, no generation side effect) | Hermetic: `GET` does not call the mock LLM provider |
| AC-3 | Regenerate → 1 LLM call, fresh timestamp | Step 6.5.b–j (`generateTour` orchestration) | Hermetic: mock LLM call-count assertion; `generated_at` changes across two calls |
| AC-4 | Facts/ranking/reading-path = zero LLM | Steps 5, 6.5.c/d (all fact gathering via `repoIntel.*`/GitHub adapter, no LLM) | Hermetic: fact-gathering helpers invoked with LLM provider never called |
| AC-5 | Exactly one LLM call per generation (full or lite) | Step 6.5.f (single `completeStructured` call site) | Hermetic: call-count assertion in both full-mode and lite-mode test cases |
| AC-6 | Log one LLM call + cost in cents | Step 6.5.h–i | Hermetic: log line assertion (mock/child logger spy) with `llm_cost_cents` present; manual: Step 8.4 |
| AC-7 | Reading path ordered by rank desc, never alphabetical — **server owns order, not the LLM** | Step 6.3 `attachRankOrder` (server-computed `getTopFilesByRank` is the master order; only the LLM's per-path rationale TEXT is consumed, its response order is discarded), Step 6.5.g (post-process re-attach), Step 7.7 `ReadingPathSection` (no client re-sort) | Hermetic: server test where the mock LLM deliberately returns rationale in a DIFFERENT order than rank — asserts final response order matches `getTopFilesByRank`'s rank order, NOT the LLM's order and NOT alphabetical; RTL: DOM order matches prop array order |
| AC-8 | GitHub blob link on resolvable entries | Step 6.3 (`mapGithubLink`) | Hermetic: entry with resolvable path gets non-null `github_link` matching the blob URL pattern |
| AC-9 | No Open action when unresolvable | Step 6.3 (`mapGithubLink` returns null), Step 7.7 `CriticalPathsSection` (conditional render) | Hermetic: entry with no repo basics/sha gets `github_link: null`; RTL: no Open button rendered for null-link entry |
| AC-10 | Lite mode + CTA on no clone/index | Step 6.5.d (lite-mode fact gathering), Step 7.6 (CTA calling existing `/resync`) | Hermetic: `getIndexState` degraded/no-data → service takes lite branch, `run.mode: 'lite'` in response; RTL: CTA button renders and posts to `/resync` |
| AC-11 | Partial/degraded → badge, tour still generated | Step 6.5.b–c (index-state branching keeps generating), Step 7.7 `SectionCard` degraded badge (sourced from `OnboardingTour.run`) | Hermetic: `partial`/`degraded` index states both produce a non-empty tour with `run.degraded: true`; RTL: badge renders |
| AC-12 | No data anywhere → deterministic skeleton | Step 6.5.e | Hermetic: full mode unavailable AND mocked GitHub calls fail → response has 5 sections with "not enough data" bodies, LLM provider never called |
| AC-13 | Facts derived only from the selected repo (exclude gitignored/nested/dependency paths) — applies to newly-indexed/resynced repos | Step 2 (walk.ts hardening) | Hermetic: `walkClone` test fixtures with a `.gitignore`'d dir and a nested-`.git` subdir, both excluded from result. Note: pre-existing indexed repos need a resync to pick up this fix — documented in §2, not separately tested here (no regression to test, a scope statement) |
| AC-14 | Full-mode fact-gathering uses a managed clean clone, never an arbitrary working tree | Step 6.5.c (reads via `container.git`/clone path from `getRepoBasics`, never an ad hoc filesystem path) | Hermetic: service test asserts the clone-path passed to file reads comes from `repo.clonePath`, not a hardcoded/arbitrary path |
| AC-15 | Share link copies a deep-link URL | Step 7.6 (`navigator.clipboard.writeText(window.location.href)`) | RTL: click handler calls the mocked clipboard API with the current URL |
| AC-16 | Rate-limited generation (no unlimited-click fan-out), per-workspace | Step 6.6 (`config.rateLimit: ONBOARDING_RATE_LIMIT` with a custom per-workspace `keyGenerator`) | Hermetic: STATIC assertion on the registered route's `rateLimit` config (`max: 3`, `timeWindow: '1 minute'`, `keyGenerator` defined) — a real 429 CANNOT be produced hermetically because `@fastify/rate-limit` is disabled when `nodeEnv === 'test'` (`app.ts:121-125`); real 429 behavior is verified manually in Step 8.3 |
| AC-17 | Manual acceptance run on a real indexed repo | Step 8.2 | Manual walkthrough (not automated) — documented in PR description |
| AC-18 | Hard failure after prior success keeps last good tour + inline retry | Step 6.5.k (service never overwrites on failure), Step 7.6 (client keeps cached data + retry banner on mutation error) | Hermetic: service test — failing generation after a persisted row leaves the row unchanged; RTL: mutation error keeps rendering previous `data`, shows retry button |

## 7. Testing Plan

**Critical instruction for whoever writes the analyzer/service tests**: derive test cases from the spec's ACs and Edge Cases table (§14/§15 of the spec) FIRST, before looking at how the implementation actually works internally. A test suite written by reading the implementation only confirms the code does what it does — it will not catch a case the implementation silently omits (e.g. AC-12's "no data anywhere" skeleton path, which is easy to forget once full/lite mode "usually" work, or AC-7's server-owned-ordering requirement, which is easy to accidentally satisfy only in the common case where the LLM happens to preserve input order). Write the AC-derived test list, THEN implement against it.

**Server:**

| Test | Type | Covers |
|---|---|---|
| `walk.test.ts` — gitignored dir excluded | hermetic | AC-13 |
| `walk.test.ts` — nested `.git` subtree excluded | hermetic | AC-13, AC-14 |
| `walk.test.ts` — no `.gitignore` present, no regression | hermetic | AC-13 (negative case) |
| `onboarding-repository.test.ts` — workspace-scoped read (cross-workspace → null) | hermetic | data isolation (security, not a numbered AC but mandatory per R1) |
| `onboarding-repository.test.ts` — `upsertTour` cross-workspace write affects zero rows (DB-level guard, not service-level) | hermetic | R1/AP-3 mechanical enforcement (non-blocking review finding) |
| `onboarding-service.test.ts` — full mode: facts gathered, exactly 1 LLM call, rank-ordered reading path | hermetic | AC-4, AC-5, AC-7 |
| `onboarding-service.test.ts` — reading path order survives an LLM response that returns rationale in a non-rank order | hermetic | AC-7 (server-owned ordering, blocking review finding) |
| `onboarding-service.test.ts` — lite mode: no clone → GitHub Trees/Contents used, `run.mode: 'lite'`, reading path `rank: null` | hermetic | AC-10 |
| `onboarding-service.test.ts` — partial/degraded index still generates + badges | hermetic | AC-11 |
| `onboarding-service.test.ts` — no clone AND GitHub fails → skeleton, zero LLM calls | hermetic | AC-12 |
| `onboarding-service.test.ts` — entry with resolvable location gets github_link; entry without gets null | hermetic | AC-8, AC-9 |
| `onboarding-service.test.ts` — regenerate overwrites with fresh timestamp, no history kept | hermetic | AC-3 |
| `onboarding-service.test.ts` — generation failure after prior success does not overwrite persisted row | hermetic | AC-18 |
| `onboarding-service.test.ts` — large-repo fixture (>200 file_facts rows, >30 ranked files) produces an LLM input bundle within `LLM_INPUT_MAX_BYTES`/`LLM_INPUT_MAX_ENDPOINTS` | hermetic | bounded-input invariant (§4, blocking review finding) |
| `onboarding-routes.test.ts` — `GET` never generated → well-formed empty response, not an error | hermetic | AC-2 (inverse), §7 |
| `onboarding-routes.test.ts` — `GET` persisted tour, no LLM call triggered | hermetic | AC-2 |
| `onboarding-routes.test.ts` — cross-workspace `GET`/`POST` → 404 | hermetic | security / workspace isolation |
| `onboarding-routes.test.ts` — registered route config has `rateLimit: { max: 3, timeWindow: '1 minute' }` and a `keyGenerator` | hermetic (static config assertion, NOT a live 429 — see §4) | AC-16 |
| `onboarding-routes.test.ts` — log line contains `llm_cost_cents` after generation | hermetic | AC-6 |
| `onboarding-prompt.test.ts` — rendered prompt string contains the 5-kind list, no `routes_and_apis`, no 4-item cap language for reading path | hermetic | AC-1 mechanism, prompt-edit blocking review finding |
| `repo-intel-file-facts.test.ts` — `getAllFileFacts` returns full UNCAPPED inventory (fixture >100 rows), no per-symbol filtering | hermetic | supports AC-1 (routes/APIs section content), not independently AC-numbered |
| `github-adapter.test.ts` (extends existing octokit test file if present) — `getRepoTree`/`getFileContents` happy path + 404-returns-null | hermetic | supports AC-10 |

**Client:**

| Test | Type | Covers |
|---|---|---|
| `OnboardingTourView.test.tsx` — renders 5 sections in TOC + body order | RTL, fetch mocked | AC-1 |
| `OnboardingTourView.test.tsx` — persisted tour on mount does not call generate mutation | RTL | AC-2 |
| `OnboardingTourView.test.tsx` — Regenerate click calls generate endpoint, updates "last refreshed" | RTL | AC-3 |
| `ReadingPathSection.test.tsx` — DOM order matches prop array order exactly (no re-sort) | RTL | AC-7 |
| `CriticalPathsSection.test.tsx` — Open action present iff `github_link` non-null | RTL | AC-8, AC-9 |
| `OnboardingTourView.test.tsx` — lite/no-index state shows CTA, CTA posts to `/resync` | RTL, fetch mocked | AC-10 |
| `SectionCard.test.tsx` — degraded badge renders when `run.degraded` or `run.status === 'partial'` | RTL | AC-11 |
| `OnboardingTourView.test.tsx` — Share link calls clipboard with current URL | RTL, clipboard mocked | AC-15 |
| `OnboardingTourView.test.tsx` — 429 response from generate mutation shows a distinct "please wait" message | RTL, fetch mocked (429 response) | AC-16 (client-side surfacing; the server-side limit itself is verified per the Server table + manual Step 8.3) |
| `OnboardingTourView.test.tsx` — mutation error keeps last-good data + shows retry, retry re-invokes mutate | RTL | AC-18 |
| `FirstTasksSection.test.tsx` — complexity badge color maps Low/Medium/High to the local `COMPLEXITY` tokens correctly | RTL | UX requirement (§5), color-token traceability for the resolved `[NEEDS CLARIFICATION]` item |
| `app-shell/helpers.test.ts` — `activeKeyFor("/onboarding")` ≠ `"onboarding-tour"`; `activeKeyFor("/repos/x/onboarding-tour")` === `"onboarding-tour"` | hermetic (pure function) | nav-highlight collision fix (non-blocking review finding) |

**Manual (not automated):** AC-17 — full acceptance run against a real seeded, indexed open-source repo per Step 8.2. AC-16's live-429 behavior per Step 8.3 (rate-limit plugin is disabled in the automated test environment — see §4). Document pass/fail in the PR description; do not attempt to script either in CI for this plan.

## 8. Out of Scope

- Automatic/continuous regeneration on repo changes (manual "Regenerate" only, per spec Non-goals).
- Any spec-conformance or merge-blocking behavior.
- Multi-repo comparison or cross-repo tours.
- Hand-editing generated tour content.
- More than one LLM call per generation, or sending full file contents to the LLM.
- A hotness/churn signal in the ranking formula — `hotness` stays hardcoded `0`; this plan does NOT add git-churn analysis anywhere, including to `repo-intel`'s existing rank computation.
- Reading `.gitignore`-excluded/nested-repo/dependency-folder content for any repo other than the selected one (Step 2 hardens exactly this boundary and no further).
- Retroactively re-filtering already-indexed repos' stale fact sets — the walk.ts hardening (Step 2) applies to files walked from the point it ships forward; a pre-existing indexed repo needs an explicit resync to benefit (documented in §2, not a bug this plan owes a fix for).
- Adding a client-side mermaid renderer if none currently exists in the codebase — Step 7.7 explicitly allows a raw-source fallback and flags a proper renderer as a future follow-up, not part of this plan's scope.
- Nested-`.gitignore`-file merging beyond the root-level check (Step 2 treats deep per-directory `.gitignore` merging as best-effort/optional, with the root-level check as the mandatory AC-13 baseline).
- Per-repository (as opposed to per-workspace) rate-limit scoping on the generation endpoint — explicitly decided as per-workspace in this plan, enforced via a custom `keyGenerator`.
- Async/poll-based generation endpoint — this plan chooses synchronous return of the refreshed tour (spec §7 permits either); polling can be added later without a breaking contract change if generation latency becomes a problem.
- Editing or removing the pre-existing `Onboarding`/`OnboardingSection`/`OnboardingLink` placeholder contracts in `knowledge.ts` — they are left untouched; this plan's contracts use non-colliding `OnboardingTour*` names instead.
- Locale-selectable LLM narrative generation — the `{{language}}` prompt variable is fixed to `"English"` for v1; UI chrome is still separately localized via next-intl, but generated narrative content is English-only.
- An `onRequest` hook to cache `getContext` resolution and avoid the two-calls-per-request cost on the rate-limited route — noted as a possible future optimization, not implemented here.
