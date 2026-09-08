# server — engineering learnings

**While working:** append only. Read the file before writing — if the lesson
is already here, extend that entry instead of adding a second copy. If one
turns out wrong, add a new entry correcting it rather than editing history.

**During a scheduled review** (quarterly, or when this file stops being
useful): merge duplicates, delete entries about code that no longer exists,
and resolve contradictions explicitly — two entries giving opposite advice
make the agent pick at random. Treat this file as a draft under review, not
as truth; a bad entry is worse than a missing one.

Covers `server/` and its submodules, including
`server/src/modules/repo-intel` (no separate file for it).

## What Works

### 2026-07-28 — per-run cost is already computed; the pipeline just drops it

`reviewer-core` computes cost end-to-end with no extra API calls:
`OpenRouterProvider.completeStructured` (`reviewer-core/src/llm/openrouter.ts`)
asks OpenRouter for `usage: { include: true }`, prefers OpenRouter's own
`usage.cost`, and falls back to the injected `estimateCost` (wired from
`platform/price-book.ts` → `adapters/llm/pricing.ts` in `container.ts`).
`reviewPullRequest` then sums it into `ReviewOutcome.costUsd`.

Commit `d45ab0d` removed only the *persistence* of that value, not its
computation — `run-executor.ts` was destructuring `const { tokensIn,
tokensOut, grounding } = outcome;` and silently discarding `costUsd`. So
surfacing run cost is a wiring job (schema column + `completeAgentRun` +
contracts), never a provider/pricing job. Check what `ReviewOutcome` already
carries before adding anything to the LLM path.

Caveat from `reviewer-core/src/review/run.ts`: on the map-reduce strategy
`costUsd` collapses to `null` if *any* chunk lacks a cost — so null means
"unknown", and must not be rendered as $0.

### 2026-08-03 — the `conventions` table and `getConventionSamples` sat fully-provisioned and completely unused for a whole lesson

Before the Conventions Extractor (specs/03) was built, the `conventions`
table, the `ConventionCandidate` contract, the `conventions` `FeatureModelId`
(wired into Settings), and `repoIntel.getConventionSamples(repoId, n)` all
already existed in the tree — zero readers, zero writers, zero routes. Only
`repoIntel.getConventionSamples` had a real implementation (it's just
`getTopFilesByRank` under a different name); everything else was schema/
contract scaffolding waiting for a module. Before assuming a feature needs
new schema, grep for its likely table/contract name — this repo tends to lay
groundwork a lesson or two ahead of the code that uses it.

Because the table had never been written to, redesigning it in place (tri-state
`status` instead of a boolean `accepted`, added `scan_id`/line-range/`category`
columns) was free — no migration had to preserve old rows, no back-compat
shim needed. Confirm "unused" with a repo-wide grep for the table/type name
before assuming the same is safe elsewhere.

## What Doesn't Work

### 2026-08-21 — parallel git worktrees on this repo share ONE Postgres instance; running `pnpm db:migrate` in one worktree silently mutates schema another worktree's `db:generate` will collide with

`.worktrees/devdigest-review` (branch `feat/multi-agent-review`) and `.worktrees/devdigest-ci` (branch `feat/export-to-ci`) are separate git worktrees (root `CLAUDE.md`'s "parallel lab branches"), but all point at the SAME `docker compose` Postgres container as the main checkout — there is one `agent_runs`/`multi_agent_runs`/etc. table set, not one per worktree. Implementing specs/13's Phase A2 in the main checkout, `pnpm db:generate` produced the exact expected add-only migration (`agent_runs.multi_agent_run_id`), but `pnpm db:migrate` failed with `column "multi_agent_run_id" of relation "agent_runs" already exists` — the sibling `devdigest-review` worktree's OWN independently-generated migration (`0023_thick_hellion.sql`, a different file, different hash, same underlying `ALTER TABLE` for the same feature) had already been applied to the shared DB in an earlier session, recording its hash in `drizzle.__drizzle_migrations` under an id this checkout's `_journal.json` never listed. `pnpm db:migrate`'s failure surfaces as a live-DB error, not a git conflict, so `git status` being clean is not evidence the DB matches this checkout.

Fix: diagnosed via `git worktree list` + reading the sibling worktree's own `migrations/meta/_journal.json` and its `.sql` file to confirm exactly what it added and that it was schema-equivalent (same column/FK, only the index name differed) before touching anything. Rolled back ONLY the specific phantom drift this checkout's own migration would collide with — `ALTER TABLE agent_runs DROP CONSTRAINT/DROP COLUMN`, `DROP INDEX`, and `DELETE FROM drizzle.__drizzle_migrations WHERE id = <that specific row>` — then re-ran `pnpm db:migrate` cleanly. Deliberately left the UNRELATED sibling `devdigest-ci` worktree's own phantom migration row alone (a different id, touching `ci_installations`/`ci_runs`, nothing this pass touches) — it's expected to self-resolve harmlessly once `feat/export-to-ci` actually merges and its real migration file lands in this checkout's history with a matching hash. **Generalizes:** before trusting `pnpm db:generate < /dev/null`'s "one clean pass" as proof nothing is wrong, and before assuming a `db:migrate` failure means YOUR migration is malformed, run `git worktree list` and check whether any sibling worktree could have touched the same shared dev DB — the failure is otherwise indistinguishable from a genuine schema-authoring mistake.

**2026-09-07 addendum (specs/15-skill-eval-cases.md §2, main checkout, no sibling-worktree collision this time) — the SAME symptom recurs from a plain merge artifact inside this checkout's OWN committed migration history, not a live worktree race.** `pnpm db:generate` for a clean, additive-only schema change (4 nullable columns on `eval_runs`, one composite-unique-index swap on `eval_cases`) also silently re-emitted `ALTER TABLE agent_runs ADD COLUMN multi_agent_run_id` + its FK + its index — a column already applied to the live DB by `0023_flimsy_nick_fury.sql` (the `feat/multi-agent-review` merge this branch's history already contains, per `git log`). Confirmed via `docker exec devdigest-postgres psql -d devdigest -c '\d agent_runs'` (column present) and `select * from drizzle.__drizzle_migrations` (a hash whose `created_at` matches this checkout's own `0023_flimsy_nick_fury` `when` timestamp is already recorded — this is NOT a sibling worktree's row, it's this checkout's own prior apply). Root cause: `migrations/meta/0024_snapshot.json` and `0025_snapshot.json` — both already-applied, do-not-touch files — simply don't carry `multi_agent_run_id` in their `agent_runs` table snapshot even though `0023` added it and nothing later drops it; almost certainly a merge that landed `0023_flimsy_nick_fury.sql`'s SQL without regenerating the snapshot chain on top of it. Fix: same shape as the worktree case above but the file surgery differs — left `0024`/`0025` alone entirely (they're applied; editing them is the one explicit do-not-touch), and instead hand-stripped ONLY the 3 phantom `multi_agent_run_id` statements from the NEWLY generated (not-yet-applied) `0026...sql` before running `db:migrate`. Left `0026_snapshot.json` exactly as `drizzle-kit` produced it — it correctly includes `multi_agent_run_id` (matching live DB reality via the schema file, which already had the column), so it now serves as the correct baseline for the NEXT `db:generate`, self-healing the drift going forward without touching any already-applied file. **Generalizes beyond the worktree case:** after ANY `db:generate`, read the generated `.sql` for statements touching a table your OWN schema edit didn't name — even with zero sibling worktrees involved, a stale snapshot merged in from another branch can silently reintroduce already-applied DDL for a completely unrelated table, and `pnpm db:migrate` failing loudly is the ONLY signal (schema `import type` diffs and `pnpm typecheck` see nothing wrong).

### 2026-08-04 — `reviews.it.test.ts`'s "runs a review" test intermittently times out because `intentService.resolve()` makes a REAL OpenRouter network call on a dev machine with real secrets configured

`test/reviews.it.test.ts`'s `appWith()` helper only overrides `llm: { [provider]: mockLLM }` for `openai`/`anthropic` — never `openrouter`. `review_intent`'s `FEATURE_MODELS` default is `openrouter`/`deepseek-v4-flash` (unchanged since L03 v1), so every `executeRuns` batch's intent-resolution step calls the REAL, un-mocked `container.llm('openrouter')` → a genuine network call to OpenRouter, IF `~/.devdigest/secrets.json` has a real `OPENROUTER_API_KEY` (as it does on a dev machine that's used the app for real). Without that key it fails fast with a `ConfigError` (no network attempt) and the flake doesn't happen — this is why it may not reproduce in a clean CI sandbox.

Measured with temporary timing instrumentation: the intent-resolution block took anywhere from ~500ms to 3.4s+ across repeated runs of the same test, depending on network conditions and how many other testcontainers/`.it.test.ts` files were running in parallel. `test/helpers/runs.ts`'s `waitForPrRuns` has only a 10s default timeout — under load (e.g. the full `pnpm test` run, 30+ files, several spinning up their own Postgres testcontainer), the review run can genuinely take longer than 10s end-to-end and `waitForPrRuns` gives up early, so the test reads back zero persisted reviews (`expect(reviews).toHaveLength(1)` fails with `+0`, or a later test in the same file reads `reviews[0]` as `undefined`). Confirmed NOT a functional regression: re-running the same test file in isolation, or the full suite at a quieter moment, passes cleanly every time (verified twice, including a full 34-file/216-test green run) — this is a pre-existing timing race between a live network call and a fixed local timeout, present since L03 v1 shipped `intentService.resolve()` with this same provider default, not something introduced by the revision-2 (scope-based) rewrite. If this test starts failing, check whether it's this race before suspecting the diff — rerunning it alone, or bumping `waitForPrRuns`'s `timeoutMs`, is the fix, not touching `run-executor.ts`/`intent/service.ts`.

**2026-08-21 addendum (specs/13-multi-agent-review.md, `test/multi-agent.it.test.ts`) — the flake reproduced in a brand-new `.it.test.ts` file for the same reason, and the durable fix for a NEW file is to mock `openrouter` too, not just tolerate the race.** A first pass of this new test (also exercising `executeRuns` via `POST /pulls/:id/multi-agent-run`) hit the identical failure mode — one test hung well past even a bumped 25s `waitForPrRuns` timeout and cascaded into the next test's `Cannot read properties of undefined` — confirming the flake isn't specific to `reviews.it.test.ts`'s fixtures, it's inherent to any `.it.test.ts` that exercises the review-run path without overriding `openrouter`. Fix that actually eliminated it (rather than papering over it with a longer timeout): add `openrouter: new MockLLMProvider('openai', { structuredBySchema: { IntentExtraction: {...} } })` to the test's `appWith()`'s `llm` overrides — `intentService.resolve()`'s `completeStructured` call names `schemaName: 'IntentExtraction'` (`modules/intent/service.ts`), so `structuredBySchema` (not `structured`, which would fail the wrong schema's validation) is the field to use. Once mocked, the whole 5-test suite dropped from minutes (with real network calls) to ~10s, deterministically. `reviews.it.test.ts` itself was left as-is at the time (out of scope to fix here, and D16/N2 forbid touching it in this plan) — but any FUTURE `.it.test.ts` that triggers a real review run should mock `openrouter` from the start rather than inheriting this flake. **2026-09-08: `reviews.it.test.ts` now also mocks `openrouter`** (same `structuredBySchema: { IntentExtraction: {...} }` shape) — the 2026-09-08 addendum above's CI failure was the trigger; the fix eliminated the flake there too (6/6 tests, ~10s, down from real-network timing).

**2026-09-08 addendum (PR #18 CI, `server integration (postgres)`, a docs-only PR — confirms this is the SAME flake class, one narrower window inside it, not a new bug.** GitHub Actions failed `reviews.it.test.ts`'s "runs a review" test at a DIFFERENT assertion than the ones above: `trace.config.model` threw `TypeError: Cannot read properties of undefined (reading 'model')`, with `review.verdict`/`score`/`findings` already asserted correct just before it — i.e. `waitForPrRuns` DID return correctly this time (the review itself was fully persisted), but the immediately-following `GET /runs/:id/trace` came back without `config`. Traced to `run-executor.ts`'s write order: `completeAgentRun(runId, { status: 'done', ... })` (the exact field `waitForPrRuns` polls for) is awaited and returns BEFORE `saveRunTrace(runId, trace)` is even constructed, let alone awaited — so there is a real, separate window between "run looks done to any status-polling reader" and "the trace document actually exists," distinct from the network-call-vs-timeout race documented above. Confirmed unrelated to the PR's own diff: `git diff main -- server/ reviewer-core/` was empty (docs-only PR), and `evals/workflow/review-workflow.cases.ts` (the OTHER CI job failing on the same PR, `eval-workflow`) is byte-identical to `main` too, with its 3 failures citing files that don't exist anywhere in the repo (`server/docs/api-contracts.md`, `reviewer-core/docs/pipeline.md`, `reviewer-core/insights/gotchas.md`) — a second, entirely separate pre-existing staleness bug, not touched by this addendum's fix scope. **`run-executor.ts`'s write order itself was NOT changed** (that would be a behavior change, not a test fix — the durable fix would be either reordering it to `saveRunTrace` before `completeAgentRun`, or having `waitForPrRuns`-style helpers poll for the trace document too, not just `agent_runs.status`). Instead, mocking `openrouter` in `reviews.it.test.ts` (see this file's line above) removes the dominant source of timing variance across the WHOLE run (a real network call measured at 500ms–3.4s+) that made this narrow window reachable in the first place — the suite is now consistently ~10s end-to-end, so this specific race is very unlikely to resurface in CI, but it remains a latent ordering bug in `run-executor.ts` that a sufficiently slow/loaded environment could still theoretically expose.

### 2026-08-03 — `drizzle-kit generate` hangs (spins CPU, never prompts, never exits) under piped/non-TTY stdin when it needs a rename-ambiguity answer

Dropping a column and adding several new ones to the same table in one
schema-change pass makes `drizzle-kit generate` ask an interactive "is this a
rename?" question via a raw-mode terminal prompt. Piping input at it
(`yes "" | pnpm db:generate`, `pnpm db:generate < /dev/null`) does not answer
the prompt — the prompt library needs a real TTY for `setRawMode`, and
without one it spins at ~90%+ CPU indefinitely rather than erroring or
defaulting. `< /dev/null` alone hung for 90+ seconds before being killed; no
timeout, no visible progress.

Fix: split the schema change into two generate passes that are each
unambiguous on their own — pass 1 adds only new columns (temporarily keep the
old column so nothing is dropped, no rename candidate exists), pass 2 removes
the old column alone (nothing new was added, so nothing to rename it *to*).
Two small migrations instead of one, but `pnpm db:generate < /dev/null` then
exits cleanly with no prompt at all. Do this preemptively for any migration
that both drops and adds columns on the same table — don't discover the hang
by waiting on it.

**2026-08-19 addendum (specs/12-eval-pipeline.md, `eval_cases`/`eval_runs`
reshaped in the same pass) — confirms the trigger is "add+drop on the SAME
table in one pass", not "any migration touching two tables at once".**
`eval_cases` gained six new columns (`source_finding_id`, `created_at`,
`updated_at`, plus three `SET NOT NULL` tightenings on already-existing
columns) with `pnpm db:generate < /dev/null` completing cleanly in ONE pass —
tightening nullability is not a rename candidate, only add+drop is. `eval_runs`
needed the two-pass split (twelve adds, three drops: `case_id`,
`actual_output`, `pass`) — pass 1 kept the three doomed columns in
`schema/eval.ts` (with a `// ---- PASS 1 of the two-pass migration ----`
comment block marking them for deletion) alongside the twelve new ones, pass 2
deleted that block and regenerated. Both passes produced zero interactive
prompts and the exact SQL expected (`ALTER ... ADD COLUMN` only in pass 1,
`ALTER ... DROP COLUMN`/`DROP CONSTRAINT` only in pass 2) — verify the
generated `.sql` file's statements match that shape before running
`db:migrate`, since a misjudged split would only be caught by reading the SQL,
not by the generate command itself (which exits 0 either way once it's past
the hang).

### 2026-08-13 — testing a single-flight/in-flight guard with `Promise.all([callA(), callB()])` is NOT deterministic once the guarded method does real fs I/O before the guard check

`OnboardingService.generate` (specs/10-onboarding-generator.md, AC-20) uses the
standard "has-check + add, no `await` between them" in-flight guard (same
shape as any future single-flight service method). The mutual-exclusion
GUARANTEE holds — two calls can never both proceed past the check believing
the slot is free — but WHICH of two truly-concurrent calls reaches the guard
first is only deterministic when every step before the guard resolves via
pure microtask scheduling. A first test written as `const [a, b] =
await Promise.all([service.generate(id), service.generate(id)])` passed
`['generated', 'generating']` against a hand-rolled repro using only
microtask-resolving stubs, but flaked to `['generated', 'generated']` against
the REAL service — because `assembleFacts` → `detectStack`/
`collectSetupCandidates` call real `fs.stat`/`fs.readFile` (libuv thread-pool
I/O, not microtasks) before the guard, so call A can fully finish (guard
claimed → generation → guard released) before call B's fs-based prework even
reaches the guard — both then legitimately generate, and the test's
"first-caller-wins" assumption is simply wrong, not a bug in the guard.
Fix: don't race two `Promise.all`'d calls with identical fast paths — start
call A, wrap the SLOW step (here, `completeStructured`) in an artificial
`setTimeout` delay so its in-flight window is wide, await a short real delay
(~10ms) to let call A clear its fs-based prework and enter the delayed call,
THEN start call B and assert it observes `'generating'`. Generalizes to any
future single-flight/dedup guard test in this codebase whose guarded method
does fs or DB I/O before the check.

## Codebase Patterns

### 2026-08-11 — `parseUnifiedDiff` silently drops binary files, pure renames, and deletions from `diff.files` — `diff.raw` still has them

Building specs/08-pre-push-cli.md's `POST /reviews/adhoc` (a NEW consumer of
`parseUnifiedDiff` that doesn't go through `diffFromPrFiles`/`loadDiff`'s
PR-file fallback) surfaced this directly: a file entry only survives into
`UnifiedDiff.files` when a `+++ b/<path>` line set a non-empty `path`
(`adapters/git/diff-parser.ts:78`, `files.filter(f => f.path)`). Binary diffs
(`Binary files … differ`) and content-free renames never emit a `+++` line at
all; deletions emit `+++ /dev/null`, which the parser deliberately never
assigns to `current.path` (`diff-parser.ts` ~line 42). The raw diff TEXT still
reaches `diff.raw` (so a downstream LLM prompt can reference/comment on these
files), but `diff.files` — what `groundFindings`'s citation gate iterates —
omits them entirely, so any finding the model raises about a binary/rename/
delete-only file gets silently dropped for "no matching hunk", not flagged as
an error anywhere. Any new synchronous/one-shot review path built directly on
`parseUnifiedDiff` must explicitly check `files.length === 0` and reject
before spending an LLM call — `reviewPullRequest` has no opinion on this and
will happily run a review that produces zero groundable findings.

### 2026-08-11 — `ConfigError` (`platform/errors.ts`) responds HTTP 500, not a 4xx, even for a client-actionable "add your API key" condition

`container.llm(provider)` throws `ConfigError` (`code: 'config_error'`) when a
provider's API key isn't configured — conceptually a "you need to do
something" error, but `ConfigError extends AppError` with `statusCode = 500`
(`platform/errors.ts:37-41`), so it comes back as a 5xx, not a 4xx. A planning
document describing this as "endpoint 4xx from ConfigError" (as
specs/08-pre-push-cli.md's error table did) is simply wrong relative to the
actual code — verify against `platform/errors.ts` before trusting a spec's
status-code claim for any `AppError` subclass. Any consumer that wants a
distinct message for this case (e.g. the CLI's "add the provider's API key in
Settings, then retry") must branch on the error envelope's `code ===
'config_error'` field, never on the HTTP status band — the exact same shape
as the already-documented 429-mislabeled-`internal_error` gotcha
(`mcp-server/LEARNINGS.md`): this codebase's error `code` field is the
reliable signal, its HTTP status is not always the one you'd guess.

### 2026-08-04 — the seeded `acme/payments-api` PR #482 has non-zero `additions`/`deletions` but empty `patch` text on every `pr_files` row, and `files_count` (9) doesn't match the actual seeded row count (4)

Verified building Smart Diff (specs/06-smart-diff.md) against this PR — it's
the same PR the course's Smart Diff mockup screenshot uses (`src/middleware/
ratelimit.ts`, `src/api/public/webhooks.ts`, `src/api/users.ts`,
`src/config.ts`), so it's a likely target for future demos/screenshots of any
diff-rendering feature. `GET /pulls/:id` returns real `additions`/`deletions`
per file but `patch: null` for all four rows, so `DiffViewer`/`FileCard` (and
now `SmartDiffViewer`) correctly render "No diff text available" for every
file — this is NOT a bug in the diff renderer or the classifier, it's how the
seed data was authored. Also `pull_requests.files_count` is seeded as `9`
while only 4 `pr_files` rows actually exist for this PR — another seed-data
mismatch, not a bug in whatever reads `files_count` vs. `files.length`. If a
future session sees "Files changed · 9 files" but only 4 file cards render,
or an empty diff body on this specific PR, check the seed data before
suspecting the feature under test.

### 2026-07-28 — list endpoints denormalize per-PR data with IN-query + JS grouping, not SQL joins

`GET /repos/:id/pulls` (`modules/pulls/routes.ts`) does not join `reviews` or
`agent_runs`. It collects `prIds`, runs one `inArray(...)` query ordered
`desc(createdAt/ranAt)`, and takes first-seen-per-PR in a JS `Map` as "the
latest". Follow that shape when adding another per-PR column (I added the
`latestRunByPr` block for tokens/cost this way).

Non-obvious part: the newest `agent_runs` row for a PR is frequently *not*
`done` (still running, or failed). Gate on `status === 'done'` when building
the map, otherwise the list shows a half-finished run's zeroed tokens — or
worse, silently falls through to an older run's numbers as if they were
current.

### 2026-08-21 — a "reserved" wire contract can be a deliberate DISPLAY subset that a same-feature ALGORITHM still needs the full shape for — don't force the algorithm's signature to match the contract

specs/13-multi-agent-review.md's `AgentColumnFinding` (`vendor/shared/contracts/observability.ts`) has `start_line` but deliberately NO `end_line` (D13: "a deliberate compact subset for AC-32's column display"). But `computeConflicts`'s D-P1/D-P3 matching (file-scoped-vs-line-scoped classification, interval-merge) genuinely needs the finding's full `[start_line, end_line]` span — the plan's own pseudocode signature `computeConflicts(columns: AgentColumn[])` is literally unsatisfiable as written, since `AgentColumn.findings` only carries the display subset. Fix: `conflicts.ts` declares its OWN local `ConflictFinding`/`ConflictColumn` types (a superset of the wire shape, plus `end_line` and the raw `rationale`), and `MultiAgentService.assemble` builds this richer shape directly from the persisted `FindingRow`s — separately from (but alongside) the compact `AgentColumnFinding[]` it builds for the actual HTTP response. Generalizes: when a plan's pseudocode signature references a "reserved" or already-shipped contract type, verify that type's fields against what the ALGORITHM actually needs before implementing to that literal signature — a display contract being narrower than an internal computation's needs is a legitimate design (not a bug to "fix" by widening the wire contract), and the right move is a separate internal type, not a schema change.

### 2026-07-28 — `vendor/shared` copies have already drifted

Diffing `server/src/vendor/shared` against `client/src/vendor/shared` shows
they're not identical: server has `sessionId`, the `openrouter` provider id,
`CommitFile`/`CommitFilesPayload` that client's copy lacks. There is no sync
script — editing a shared contract in one copy does not propagate to the
other; the other package keeps stale types and still type-checks clean.

### 2026-08-03 — a new module needing another module's repo/service must use the `AgentLookup`-style local port, not a direct import — `pnpm arch` catches it, but only per-file

`no-cross-module` in `.dependency-cruiser.cjs` fires on ANY file inside a
module folder — `service.ts` and `routes.ts` alike, not just services — so
composing a new module (`conventions/{service,routes}.ts`) by importing
another module's repository or service class directly fails CI immediately
(6 errors from one new module in `add page conversations`, 2026-08-03). The
established fix, already used by `reviews/service.ts`'s `AgentLookup`
(`modules/reviews/service.ts:1-12`): declare a narrow interface locally in the
consuming service describing only the methods it calls, and let the real
class satisfy it structurally — never import the other module's type. Wire
the concrete instance only at the composition point (`routes.ts`), and if the
dependency is cross-cutting (a repository, or a same-shaped instantiation
every module would otherwise repeat), promote it to a `platform/container.ts`
getter (`container.repoRepo`, `container.skillsService`) instead of
`new XRepository(app.container.db)` inline in the route — mirrors the existing
`agentsRepo`/`skillsRepo`/`reviewRepo` getters. `service.ts` files additionally
may not import `Container` at all (`no-container-in-services`), including
type-only — so a container-dependent helper (e.g. `resolveFeatureModel`) needs
its signature narrowed to the one thing it actually reads (here: `Db`, not the
whole `Container`) before it can be called from a `service.ts` at all, and
before `container.ts` can wrap it as a method without creating an import cycle
(`container.ts → feature-models.ts → container.ts`).

**2026-08-06 addendum — both `no-cross-module` and `db-only-in-repositories`
fire on `import type`-only edges too (`tsPreCompilationDeps: true` in
`.dependency-cruiser.cjs`), and the fix for each is slightly different from
the value-import case above.** Building a standalone `recalculateIntent` on
`modules/reviews/service.ts` that needed `modules/intent/service.ts`'s
`ResolveIntentInput`/`IntentResolution` shapes: even `import type { ... } from
'../intent/service.js'` counts as a `no-cross-module` edge and fails `pnpm
arch` — the `AgentLookup` local-interface fix above generalizes to types too,
not just value imports (declare `IntentResolveInput`/`IntentResolveResult`
structurally in `service.ts` itself; `container.intentService.resolve`
satisfies it with zero casts, since TS structural typing doesn't care that the
shapes aren't nominally the same interface). Separately, that method also
needed a repo row type (`typeof schema.repos.$inferSelect`) that had no
existing named export — importing `db/schema.js` directly would have been a
*new* `db-only-in-repositories` violation (the baseline matches exact
from→to file pairs, see the 2026-08-03 entry below), even though
`service.ts → db/rows.js` was already baselined for `AgentRow`/`PullRow`. Fix:
add the missing alias to `db/rows.ts` (`export type RepoRow = typeof
t.repos.$inferSelect;` — exactly the file's own stated purpose, "cross-cutting
consumers can reference a row shape without importing another module's data
layer") and import `RepoRow` from there instead — reuses the already-baselined
edge, adds zero new violations. Before importing anything from `db/schema.js`
in a `modules/**` file, check whether the type already has (or should get) an
alias in `db/rows.ts` first.

**2026-08-06 second addendum — a spec saying a module "may import X directly
because X is already the cross-module-safe facade" does NOT mean the import
is exempt from `no-cross-module`; it means the resulting baseline entry is
expected/sanctioned.** specs/07-blast-radius.md explicitly told `blast/
service.ts` it could import `RepoIntel`/`IndexStatus`/`DegradedReason` types
straight from `repo-intel/types.ts`, since `RepoIntel` is the facade every
feature is meant to read repo intelligence through. `pnpm arch` still failed
on that edge exactly like the pre-existing `repos/service.ts -> repo-intel/
constants.ts` baselined violation (2026-08-03 entry above) — `.dependency-
cruiser.cjs` has no special-case for `repo-intel`, "safe facade" is a design
position, not a rule exemption. Fix was the same `pnpm arch:baseline` +
`git diff .dependency-cruiser-known-violations.json` (confirm exactly one new
edge added) already documented above; don't expect a spec's "X is safe to
import directly" language to mean `pnpm arch` passes with zero new baseline
entries.

**2026-08-11 addendum — the cheapest fix for a NEW module needing only a
handful of an existing row type's fields is often to not import the row type
at all, rather than adding a `db/rows.ts` alias.** Building
`AdhocReviewService` (`modules/reviews/adhoc.ts`, specs/08-pre-push-cli.md) —
a brand-new file, so importing `AgentRow` from `db/rows.ts` would have been a
*new*, unbaselined `db-only-in-repositories` edge exactly like the
`RepoRow`/`db/schema.js` case two addenda up, even though the identical
`AgentRow` import is already baselined for the sibling `reviews/service.ts`
(baselines match file PAIRS, not types). Rather than adding another
`db/rows.ts` alias (that file's fields are already all standard columns, no
missing export), this service just never imports `AgentRow` — it declares a
fully local `AgentRecord { id, name, provider, model, systemPrompt, strategy,
ciFailOn }` interface, and `AgentsRepository.getById`'s real `AgentRow`
return value satisfies it structurally with zero cast. Net effect: zero new
`pnpm arch` violations, no `arch:baseline` run needed, and the port ends up
narrower (and more honest about what the service actually reads) than reusing
the full row type would have been. When a new module-ring file needs only a
few fields of an existing DB row type, check whether skipping the import
entirely (a fully local interface) is cheaper than either extending
`db/rows.ts` or eating a new baseline entry — it usually is.

### 2026-08-06 — repo-intel's `tryPersistentBlast`: an "empty declared-symbols" early return was silently skipping the file-level 2-hop reverse-import fact lookup too

Building specs/07-blast-radius.md's gap #3 fix (`reverseImportImpact`,
`repo-intel/service.ts`), the pre-existing `tryPersistentBlast` returned
`{changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false}`
immediately whenever a changed file declared zero bare-name (function/method/
class) symbols — e.g. a changed file that's all types/interfaces, or a config
file. That early return happened BEFORE any file-level reverse-import walk
could run, even though the walk operates on changed FILES, not changed
SYMBOLS, and is specifically meant to catch a route file that imports a
service that imports the changed file, with no direct reference row to any
specific symbol at all (exactly the scenario a symbol-less changed file
produces). Left as-is, the whole point of the 2-hop fix would be unreachable
for that entire class of changed file. Fix: moved `getResolvedCallers` behind
`nameSet.size > 0` (still skipped correctly — there's nothing to look up
callers for) but let `reverseImportImpact` + `repo.getFileFacts` run
unconditionally off `changedFiles`, so `changedSymbols`/`callers` can be `[]`
while `impactedEndpoints`/`factsByFile` are still populated. Covered by
`test/repo-intel-blast-persistent.it.test.ts`'s third case (a changed file
with a 2-hop import chain to an endpoint, and NO declared symbols at all).

Separately, this exposed a real, unresolved design question one ring up:
`blast/service.ts`'s mapper groups `endpoints_affected`/`crons_affected` onto
each `DownstreamImpact` ONLY from `factsByFile` entries keyed by that group's
OWN caller files (per the spec's literal wording, and the pre-existing
`BlastResult.factsByFile` doc comment: "so consumers can attribute them to
the changed symbol whose callers live in that file"). A file reached ONLY via
the 2-hop reverse-import walk — no reference row to the specific symbol at
all — has no caller-based group to attach to, since the reserved
`BlastRadius` vendor/shared contract has no file-level/top-level slot for it
(only additive `rank`/`summary.nullish()` were in scope to add). So that
class of endpoint impact is now correctly COMPUTED (`repo-intel`'s job, gap
#3) but not currently SURFACED anywhere in the HTTP response — it's real,
reachable-in-2-hops data that the current contract shape has no home for.
Whoever builds the "PR Brief card" lesson (`pr_brief`, which `BlastRadius` is
reserved for) should decide whether that needs a new field before reusing
this contract as-is.

**2026-08-14 addendum — resolved by specs/11-why-risk-brief.md (plans/11 Q1):
the shared `BlastRadius`/`DownstreamImpact` contract was NOT widened; the
brief reads `RepoIntel.getBlastRadius`'s raw `BlastResult` directly instead of
going through `blast/service.ts`'s `toBlastRadius` mapper.** `BlastResult`
(`repo-intel/types.ts:89-102`) already carries the 2-hop-only impact via its
flat `impactedEndpoints: string[]` union and `factsByFile` map keyed by every
impacted file (including 2-hop-only ones) — the loss described above happens
strictly ONE ring up, in `toBlastRadius`'s per-caller-group regrouping, which
`modules/brief/facts.ts` never calls. `modules/brief/ports.ts` declares its
own local `RepoIntelBlastResult`/`RepoIntelPort` (shapes copied from
`repo-intel/types.ts`, never imported — the established local-port rule) and
`modules/brief/service.ts` wires the real `container.repoIntel` in at
`container.ts`'s `briefService` getter. Net effect: zero change to
`BlastRadius`/`DownstreamImpact`, zero change to how the Blast Radius CARD
renders (N11 held), and the previously-uncapturable 2-hop endpoint now reaches
a brief's fact set and grounding's `knownEndpoints` set. Any FUTURE feature
that needs this same class of impact should read `BlastResult` directly
through a local port, not `BlastRadius`/`blast/service.ts` — the latter is
lossy by design for its own (caller-grouped) UI, not a general-purpose feed.

### 2026-08-04 — a spec's "byproduct" claim about existing behavior can be stale; verify against the adapter, not just the route it cites

specs/05-intent-layer.md's Scope item 8 asserted `PrDetail.linked_issue` is
"defined but never set by either branch of `GET /pulls/:id`
(`modules/pulls/routes.ts:218-309`)". Reading only that route file, the claim
looks right. It's actually stale: `OctokitGitHubClient.getPullRequest`
(`adapters/github/octokit.ts`) already resolves `linked_issue` itself, via its
own private `resolveLinkedIssue` (regex over the PR body + a `getIssue` call),
and `pulls/routes.ts`'s GitHub-refreshed branch already returns it by
spreading `...detail`. Only the OFFLINE/persisted branch never sets it — and
it structurally can't (no column to cache it in, no GitHub client available
offline to fetch it with), so that's not a gap either, just the same offline
posture every other GitHub-refresh field in this route already has. Net
effect: nothing needed to change for that scope item. When a spec names a
"today this doesn't happen" gap as justification for new work, check the
actual adapter/service implementation the route calls into before building
the fix — the route file alone can look like the whole story and not be.

**Follow-up (same day, caught by `plan-verifier`):** "nothing needed to
change" was true for the *output* (the field was already populated) but false
for the spec's actual instruction, which was "shared, not duplicated — put
the regex+fetch pair in `_shared`". The new `_shared/linked-issue.ts` got
built exactly as specified, but nobody deleted the old private
`resolveLinkedIssue` in `octokit.ts` (a weaker regex — no past-tense
"closed"/"fixed", no word boundary on the bare-issue match) — so two
implementations of the same lookup existed side by side, one of them dead
code. Fixed by having `getPullRequest` call the shared helper and deleting
the private one. Lesson: "the behavior already exists" and "the plan's
de-duplication instruction was carried out" are two separate claims — verify
both, not just the one that's easier to check by reading the route.

### 2026-08-12 — proving path containment against a symlink escape needs `realpath` on BOTH sides, not just the target, and needs to distinguish "escapes" from "doesn't exist yet"

specs/09-project-context-folder.md's `modules/project-context/paths.ts`
(`resolveContainedPath`) is the first place in this codebase that actually
proves containment before a checkout-relative read — `SimpleGitClient.readFile`
and `modules/conventions/samples.ts` both just `join(cloneRoot, rel)` with no
check at all (flagged, not fixed, in the plan — other callers, out of scope).
Two things worth reusing verbatim for the next feature that reads a
user-supplied path against a directory root: (1) a syntactic check alone
(`resolve(root, rel).startsWith(root)`) does NOT catch a symlink whose TARGET
escapes the root — you have to `realpath()` both the root and the resolved
path and re-check containment on the REAL paths, because `resolve()` never
follows symlinks but the eventual `readFile()` call does. (2) `realpath()`
throws `ENOENT` for a path that doesn't exist yet, which is indistinguishable
from a symlink escape unless you check `err.code === 'ENOENT'` explicitly and
map it to a DIFFERENT error (this feature's `MissingPathError`) than an actual
escape (`ContainmentError`) — the two need different downstream handling
(AC-27 "refused" vs AC-36 "missing" are different reasons in the run trace,
not interchangeable). Also: `..`/absolute-path rejection has to happen BEFORE
any `resolve()` call, not after — `isRelativeSafePath` runs first and is pure
(no fs), so a malicious path never even reaches a syscall.

**2026-08-12 addendum (caught by an automated Security Reviewer finding on PR
#9, 90% confidence) — the containment technique above was applied to
per-document reads (`paths.ts`) but NOT to `discovery.ts`'s own root-directory
check, which is a separate code path with the identical gap.**
`discoverDocuments` (`modules/project-context/discovery.ts`) validated each
configured search root with only the syntactic `resolve(cloneRoot,
root).startsWith(cloneRoot)` check, then called `walkMarkdown` on it directly.
A root itself planted as a symlink (e.g. a repo commit making `specs -> /etc`)
passes that syntactic check — `resolve()` never touches the filesystem — and
`readdir()` inside `walkMarkdown` then transparently follows it, enumerating
(and leaking file names/sizes for) arbitrary paths outside the checkout. The
per-entry `entry.isSymbolicLink()` skip inside `walkMarkdown`'s recursion
already prevented a symlink *nested inside* the tree from being followed —
it just never covered the root itself, which is walked before that check ever
runs. Fix (`isContainedRoot`, same file): `realpath()` both `cloneRoot` and
the syntactic root path, re-check containment on the REAL paths, and skip
the root entirely (same as a genuinely-missing root) if that fails.

Non-obvious follow-up gotcha: passing the REALPATH'd root into `walkMarkdown`
(instead of just using it for the check) breaks path output whenever
`cloneRoot` itself sits under a symlink — e.g. macOS's `/tmp -> /private/tmp`,
which every `mkdtemp(tmpdir())`-based test fixture in this module hits. Once
the root is realpath'd but `cloneRoot` isn't (or vice versa), `full`
(descended from the realpath'd root) and `cloneRoot` (still the original,
symlinked path) are in two different filesystem namespaces, so
`relative(cloneRoot, full)` produces garbage (leading `../` segments) instead
of a clean repo-relative path — silently, no thrown error, would only surface
as mysteriously-wrong `DiscoveredDoc.path` values. Fix: use the realpath'd
root ONLY for the containment boolean check; walk the ORIGINAL syntactic root
path (the OS still dereferences it for the actual `readdir`/`stat` I/O — the
check already proved that's safe). Any future containment check that needs to
call `realpath()` on a directory it's about to recurse into, but also needs to
compute paths relative to an ancestor of that directory, should use the same
split: realpath for the boolean proof, syntactic path for everything that
touches `relative()`.

Separately: `pnpm db:generate < /dev/null` for this feature's two new tables
(`agent_context_docs`, `skill_context_docs`) plus one new nullable column
(`repos.doc_roots`) generated cleanly in one pass with zero prompts — this
migration only ADDS, confirming the 2026-08-03 entry above (drop+add in one
pass is what hangs; pure-add doesn't). `pnpm arch` also passed with ZERO new
violations on the first attempt (no `arch:baseline` run needed) — the whole
module stayed inside the established shape: `project-context/service.ts`
declares `AgentLookup`/`SkillLookup`/`AgentSkillLookup` ports locally instead
of importing `modules/agents/repository.ts` or `modules/skills/repository.ts`
directly, `modules/skills/service.ts` gained a `ProjectContextLookup` port the
same way instead of importing `modules/project-context/*`, and the one
genuinely shared piece (`renderProjectContextBlock`, needed by BOTH the skills
module's preview and the reviews module's run/adhoc paths) went into
`modules/_shared/project-context-render.ts` exactly like `skill-render.ts`
already does — composing through `_shared` and `platform/container.ts`
getters from the start avoided every `no-cross-module` violation this size of
feature would otherwise produce.

### 2026-08-19 — a bare `pr_files.patch` becomes a parseable unified diff by prepending three lines; the frozen result round-trips `parseUnifiedDiff` deterministically

specs/12-eval-pipeline.md's eval-case creation freezes one file's diff at
capture time (D8/D16), but `pr_files.patch` (GitHub's per-file patch, as
stored by this app) is hunks only — no `diff --git a/<path> b/<path>`, `---
a/<path>`, or `+++ b/<path>` header — and `parseUnifiedDiff`
(`adapters/git/diff-parser.ts`) keys a file's path off the `+++ b/<path>`
line, so handing it a bare patch parses to zero files (see the 2026-08-11
entry above for the sibling gotcha about binary/rename/delete-only files).
Fix (`modules/eval/frozen-input.ts`'s `synthesizeFrozenDiff(path, patch)`):
literally concatenate `diff --git a/<path> b/<path>\n--- a/<path>\n+++
a/<path>\n` in front of the stored patch text. This is now the SECOND place
in the codebase constructing a self-contained diff from patch-only text (the
first being any future caller of a bare `pr_files.patch` outside the
PR-review path) — any new consumer of `pr_files.patch` that isn't going
through `diffFromPrFiles`/`loadDiff`'s existing PR-file assembly should reuse
this helper rather than re-deriving the three-line header. Verified this
round-trips to exactly one `UnifiedDiff.files` entry with the expected path
and correct new-side line numbers by running the parser directly against
seeded fixture patches before wiring them into `seed-eval-cases.ts` — cheaper
than debugging a silently-empty `diff.files` after the fact.

## Tool & Library Notes

### 2026-08-25 — specs/13-multi-agent-review.md Phase A1: the concurrent per-agent loop held AC-19/AC-20 by construction, with zero changes to `RunLogger`/`RunBus` — confirmed by a new test, not just re-asserted

`run-executor.ts`'s per-agent job loop (`executeRuns`) went from a sequential
`for…of` to `await Promise.allSettled(jobs.map(...))` over the byte-identical
body (D16). The plan's own planner finding 3 predicted this stays safe purely
because `RunLogger.forRun` returns a NEW instance (never mutates the parent)
and `RunBus` keys emitters/buffers/seq/completed/cancelled by `runId`
throughout — `run-executor.concurrency.test.ts` (new, colocated) now proves
this against the REAL executor rather than trusting the prediction: four
succeeding + one deliberately-throwing fake-LLM agents run concurrently, and
each run's own `RunBus.buffer(runId)` contains only that run's own per-agent
log lines (agent name, its failure text) alongside the shared pre-work lines
("Diff ready…", fanned out before the loop) — no cross-run leakage in either
direction. Same file also pins AC-16 (N agents at delay T complete in ~T, not
~N×T, using a local `DelayedLLMProvider` since `src/adapters/mocks.ts`'s
`MockLLMProvider` has no delay knob — built one locally rather than widening
the shared mock for one timing-sensitive test), AC-17 (every other agent still
persists its own review/findings when one agent's provider throws — the
failing run never reaches `insertReview`, the succeeding ones do), and AC-18
(the diff loads exactly once for the whole batch, asserted via a
`container.git.diff` call counter, not per-agent).

**New provider-load exposure this concurrency change creates, to be watched
rather than rediscovered as an incident:** N agents now hit their configured
LLM provider(s) SIMULTANEOUSLY instead of one at a time. A provider that
throttles under concurrent load (e.g. per-key rate limits, concurrent-request
caps) can now see a burst it never saw under the old sequential loop, even
though the SAME total request volume crosses it either way. The plan
deliberately ships no concurrency cap/queue for this slice (AC-59's copy is
explicit that nothing here uses `p-queue` — introducing one now would be the
exact regression that copy is written to prevent) — a throttled agent still
fails in isolation (AC-17/AC-47), it just does so under a load pattern this
codebase hasn't exercised before. If real usage shows provider throttling
correlating with multi-agent batch size, the fix is a concurrency cap on the
`jobs.map(...)` batch (e.g. a small worker-pool limiter), not reverting to the
sequential loop.

**The add-only migration behaved exactly as finding 5 predicted, no
surprises.** `0023_flimsy_nick_fury.sql` (`agent_runs.multi_agent_run_id`, a
nullable FK to `multi_agent_runs.id` with `ON DELETE set null`, plus its
index) is a single `pnpm db:generate < /dev/null` pass containing only `ALTER
TABLE ... ADD COLUMN`, one `ADD CONSTRAINT`, and one `CREATE INDEX` — no
interactive rename prompt, confirming (again) that the 2026-08-03 hang below
is specifically an add+drop-on-one-table trigger, not a general multi-statement
one.

### 2026-08-25 — most of `server/src/modules/ci/` was never `git add`ed despite four "committed phases" on this branch, and a plain `git stash` (no `-u`) silently reverts only the tracked half

`git ls-files server/src/modules/ci/` returns exactly three files
(`bundle.ts`, `constants.ts`, `service.ts`) even though the branch's four
phase commits (`bcf781d`..`8594b7d`, specs/14-export-to-ci.md) describe a
13-file module — `ingest.ts`, `manifest.ts`, `memory-export.ts`, `ports.ts`,
`redact.ts`, `refresh.ts`, `repository.ts`, `routes.ts`, `targets.ts`,
`workflow.ts` and `workflow.test.ts` are all real, working, imported-by-the-app
code (the app doesn't build without them) that simply never got staged into
any of those commits. Running a plain `git stash` (not `git stash -u`) mid-session
to get a "before" typecheck baseline stashed only the tracked files, leaving
the untracked majority of the module in place — the resulting typecheck ran
against a HALF-reverted tree and produced a misleading error set (stale
`repo`-column errors that were actually caused by the untracked files' current
state, not by the stashed edit). Before using `git stash` as a quick "what did
I just break" check in this module (or any module where `git status` shows a
mix of `M` and `??` inside the same directory), use `git stash -u` or just
diff the specific files you changed instead of trusting a plain stash to
represent "before my edit".

### 2026-08-25 — `yaml`'s `Document`/`stringify` needs two non-obvious opt-ins to fully replace a hand-rolled `lines.join('\n')` workflow builder: `lineWidth: 0`, and the comment API for a trailing `# vX.Y.Z` annotation

Rewriting `modules/ci/workflow.ts` (plan-verifier CONTRADICTED finding — it had
been built with `Array.prototype.join('\n')` over hand-quoted strings despite
plans/14-export-to-ci.md's explicit P-9 decision to use `yaml`'s `stringify`
throughout, same as `manifest.ts` already does) surfaced two gaps a naive
`yaml.stringify(plainObject)` call doesn't cover:

1. **Long single-line string values get auto-folded across multiple lines by
   default** (`lineWidth: 80`). The "Write run metadata" step's `run:` value
   (a ~200-char `node -e "..."` one-liner) got silently reflowed onto a second
   indented line — re-parses to the same string (plain-scalar folding collapses
   the inserted newline+indent back to a single space), so it's not a
   correctness bug, but it's a needless behavior-preserving risk to accept for
   zero benefit. Fix: `doc.toString({ lineWidth: 0 })` disables folding
   entirely — every scalar renders on one line, matching what the previous
   hand-rolled implementation produced.

2. **A genuine trailing YAML comment (e.g. `uses: actions/checkout@<sha> #
   v4.4.0`, where `# v4.4.0` must stay a real comment, ignored by any YAML
   parser, and never become part of the `uses:` string value itself) requires
   the `Document`/`Scalar` node API, not a plain-object `stringify` call** —
   there is no way to attach a per-field comment to a plain JS object before
   handing it to `stringify`. Fix: build the object as normal, wrap it in
   `new Document(obj)`, then `doc.getIn(path, true)` (the `true` — "keep
   scalar" — argument is required; without it you get the unwrapped JS value,
   not the `Scalar` node) to get the actual `Scalar`/`Pair` node and set
   `.comment = ' v4.4.0'` on it directly. Checking `'comment' in node` to guard
   this is a trap — it's `false` for a fresh `Scalar` even though assigning to
   it works fine (the property isn't declared until you set it); test
   `node instanceof Scalar` instead. The document-level leading `# Generated
   by...` header comment is simpler — `doc.commentBefore = '...'` — but note
   it always inserts one blank line between the comment block and the first
   real key, a formatting difference from the original hand-rolled output that
   has no semantic effect (confirmed by parsing old vs. new output and
   deep-equal-comparing the two, across four `{triggers, postAs}`
   combinations plus one adversarial trigger-list case with embedded `"; key:
   value\n` — all four normal cases matched exactly once the multi-line
   `path: |...|` block's trailing-newline chomping mode was also matched, by
   ensuring the JS string itself ends in `\n` so `yaml` picks clip (`|`) over
   strip (`|-`) chomping).

Separately, `OctokitGitHubClient.downloadArtifact` (defence-in-depth per the
same plan-verifier pass) now calls `octokit.rest.actions.getArtifact({owner,
repo, artifact_id})` — a real, cheap metadata-only endpoint distinct from
`actions.downloadArtifact` — to read `size_in_bytes` and reject (a thrown
`ValidationError`, matching this file's now-established "typed error, never a
silent null/throw of a bare `Error`" convention) BEFORE the redirect-following
download call ever buffers the artifact body into memory. This re-fetches the
same field `listRunArtifacts` already returned earlier in `CiService`'s ingest
flow, deliberately: the check holds even if some future caller obtains an
artifact id a different way and skips the `listRunArtifacts` step entirely.
The chosen cap (16 MiB) is a copy-by-value constant local to `octokit.ts`, not
an import of `modules/ci/ingest.ts`'s `ARCHIVE_ENTRY_LIMIT`/`MAX_ENTRY_BYTES`
(64 × 256 KiB) — an adapter importing a specific feature module's internal
caps would be a backwards dependency (adapters are outer-ring; a module-
specific constant isn't a port), so the two stay independently declared with a
comment cross-referencing each other for consistency instead.

### 2026-09-07 — `@stryker-mutator/core@10.0.0` pulls in a broken Babel 8 tree; pin to `9.6.1`, and a `pnpm install --force` does NOT clean up the wreckage

Set up mutation testing on `src/modules/eval/scoring.ts` (`stryker.config.json`,
`stryker.vitest.config.ts` — a narrowed vitest config scoping `include` to just
`scoring.test.ts` so a mutation run stays under a minute instead of re-running
the full ~745-test suite per mutant). `pnpm add -D @stryker-mutator/core
@stryker-mutator/vitest-runner` resolved `^10.0.0` (latest), which pulls in
`@babel/core@8.0.1` transitively (Stryker's own instrumenter depends on Babel
presets/plugins with loose ranges) — Babel 8 at this dist-tag has an internal
ESM/CJS interop bug (`@babel/plugin-proposal-decorators`'s ESM build required
via CJS from `@babel/core`), so every mutation run crashed with
`ERR_REQUIRE_ESM` before instrumenting anything.

**Do not try to fix this with `pnpm.overrides`.** Pinning just `@babel/core` +
`@babel/plugin-proposal-decorators` to `^7.x` left OTHER Babel packages in the
same tree (`@babel/preset-typescript`, `@babel/preset-react`, `@babel/helper-
create-class-features-plugin`, …) still resolving independently to `8.0.1`
(their own ranges weren't covered by the override), producing a split-brain
7/8 install and a DIFFERENT crash (`@babel/helper-compilation-targets`
requiring a `lru-cache` whose export shape didn't match what it expected).
**The fix that actually worked: downgrade to `@stryker-mutator/core@9.6.1` +
`@stryker-mutator/vitest-runner@9.6.1`** (the last pre-10.x release) — its
Babel tree resolves uniformly to `7.29.7`, no overrides needed.

Even after downgrading, the crash didn't go away on the first retry — `pnpm
install` (with or without `--force`) reuses/relinks existing on-disk nested
`node_modules/` directories under `node_modules/@babel/*` rather than purging
ones a prior (bad) install left behind; 18 stale nested `node_modules` dirs
survived three separate `pnpm add`/`pnpm install --force` cycles, each still
pointing at Babel-8-era packages (confirmed via `node -e "require.resolve('lru-
cache', {paths:[...]})"`, which resolved to a completely different file than
`pnpm why lru-cache` reported). **The only fix that reliably cleared it: `rm
-rf node_modules && pnpm install`** — a full wipe, not a targeted one. If a
future dependency swap in `server/` produces a `require`/interop error that
persists across `pnpm install --force`, suspect stale nested `node_modules`
before suspecting the lockfile or the new package itself.

Mutation score on `scoring.ts`: 150/161 mutants killed (93.17%) after adding
one boundary test for `matches()`'s range-intersection — the existing "wide
finding overlapping by one line" test only covered the overlap landing on the
*finding's* low end (`start_line < end_line`, overlap at `end_line`); nothing
covered a finding whose overlap lands on its own `start_line` (starts exactly
on the expectation's `end_line` and extends past it), which is a different
branch of the `Math.min`/`Math.max` normalization in `matches()` — that gap
alone left two independent mutants (a `Math.min`→`Math.max` swap and a
`<=`→`<` swap, both on the same two lines) surviving simultaneously. The
remaining 11 survivors are lower-value: dead-ish branches in `classifyEffects`
guarded by conditions the paired-case invariant from `pairArms` already makes
unreachable in practice, and one `traces_passed` mutant equivalent to "count
scored cases" vs "count passing cases" that no existing fixture happens to
distinguish — left as open follow-up, not fixed here (task scope was "kill
one").

## Recurring Errors & Fixes

### 2026-07-28 — `.nullable()` on a shared contract breaks every fixture that builds it

Adding `cost_usd: z.number().nullable()` to `RunStats`/`RunSummary`
(`vendor/shared/contracts/trace.ts`) makes the *key required* — value may be
null, presence may not. Every object literal building one of those types
stops compiling until the field is added, including test fixtures far from
the change (`server/test/contracts.test.ts` `RunTrace` fixture, client's
`RunHistory.test.tsx` / `RunTraceDrawer.test.tsx`).

Use `.nullable()` when siblings are required-but-nullable (`RunStats`,
`RunSummary`); use `.nullish()` for `PrMeta`-style optional-tolerant types
where `score`, `opened_at` etc. are already `.nullish()`. Picking the wrong
one is not caught by tests — it shows up as a spray of TS2741/TS2719 errors
in unrelated files, or as a field that silently goes missing from responses.

### 2026-08-03 — a `*/` inside a JSDoc comment's own text silently truncates the comment, and the cascade of errors points nowhere near the cause

Writing `.claude/skills/*/SKILL.md` or `` `*/SKILL.md` `` inside a `/** ... */`
block (describing a glob path) closes the comment at that literal `*/` —
whatever the comment meant to say next becomes real code. `tsc` doesn't error
at that line; it errors dozens of lines later, wherever the resulting
stray-identifier soup finally produces something structurally invalid
(`TS1127 Invalid character`, `TS1443 Module declaration names...`, `TS1161
Unterminated regular expression`). The line numbers in the diagnostic are
nowhere near the actual bug.

Found in `modules/skills/helpers.ts` (written by an agent, describing
`SKILL.md`-matching glob patterns in its own doc comments) — two separate
occurrences, ~30 and ~90 lines before their respective error clusters started.
The fix is always the same: grep the file for `\*/` and check whether every
hit is an *intentional* comment terminator (`grep -n '\*/' file.ts`, read each
one). When a comment must describe a path containing `*/`, rephrase around it
("matches `SKILL.md` at any depth") rather than writing the literal glob.

### 2026-08-03 — two independent enabled-gates, not one: don't let "disabled" collapse to a single flag

Skills (L02) are gated twice: `skills.enabled` (workspace/vetting — is this
skill trustworthy at all) and `agent_skills.enabled` (per-agent — does *this*
reviewer use it). A skill reaches a prompt only when both are true, and they
must stay genuinely independent columns, not one derived from the other:
disabling a skill workspace-wide must silently drop it from every agent's
prompt while every agent's own checkbox stays visibly checked (so re-enabling
the skill instantly restores every agent that had it), and toggling the
per-agent gate off must NOT delete the `agent_skills` row — deleting it loses
`order`, and re-linking would append the skill to the end of the prompt instead
of restoring its place. `AgentsRepository.setSkillEnabled` upserts in place for
exactly this reason; `AgentsRepository.enabledSkills` ANDs both flags in one
query rather than checking them in two places that could drift apart.

### 2026-08-03 — evidence verification, not model honesty, is what makes "every candidate cites real code" true

The Conventions Extractor's LLM call (`ConventionsService.extract`) is
explicitly instructed to quote real snippets, but the guarantee that evidence
is real does NOT come from the prompt — it comes from
`findSnippetLines` (`modules/conventions/evidence.ts`) re-reading the cited
file off the clone and searching for the snippet (whitespace-normalized) after
the model responds. A candidate whose file is missing or whose snippet isn't
found is dropped before it ever reaches the DB or the UI. Same shape as
`groundFindings` in reviewer-core (never trust a citation without checking it
against the source), but this one runs in the *server* module rather than the
shared review engine, because conventions extraction isn't a
`reviewPullRequest` call at all — one-off structured calls that aren't PR
reviews still need their own citation-checking step; there's no shared gate to
reuse for them.

Also: sample selection for this feature is entirely code — no LLM call. The
mock adapter's `structuredBySchema` comment anticipated a two-step
`ConventionFileSelection` → `ConventionExtraction` dialogue, but the actual
task requirement was explicit that file *selection* is code-driven
(`repoIntel.getConventionSamples` + reading config files off the clone) and
only *extraction* is a model call. Don't assume mock/comment scaffolding
describes the final design — it can describe a design that was later narrowed.

### 2026-08-03 — `GitClient.currentHead(repo: RepoRef)` already resolves a real commit sha; no new method needed to pin evidence links

Needed a commit sha to build GitHub blob URLs for evidence found by scanning a
repo generally (not tied to a PR's `headSha`). `SimpleGitClient.currentHead`
(`adapters/git/simple-git.ts`) already runs `git rev-parse HEAD` — it just
takes a `RepoRef` (`{owner, name}`), not a raw `clonePath` string, and derives
the path itself via `clonePathFor`. Since GitHub blob URLs need
`owner/name` anyway, this was already the right shape with no new adapter
method. Check the `GitClient` interface (`vendor/shared/adapters.ts`) before
adding a path-based read — most of what you'd want (`currentHead`, `readFile`,
`log`) already exists keyed by `RepoRef`.

### 2026-08-03 — the file-import SSRF guard pattern: validate before fetch, size-cap the stream, not just Content-Length

`SkillsService.parseImportFromUrl` fetches a user-typed URL server-side. Two
things worth reusing verbatim for the next feature that does this:
(1) `assertPublicHttpUrl` (`modules/skills/helpers.ts`) is a pure, unit-tested
deny-list (http/https only, refuse localhost/loopback/private ranges/link-local
inc. the cloud metadata address) checked BEFORE the fetch ever fires — a test
asserts `global.fetch` was never called for a blocked host, not just that the
call errors. (2) The response body is read via a manual `getReader()` loop
that aborts once bytes read exceed `MAX_UPLOAD_BYTES`, because a server can lie
about or omit `Content-Length` — trusting that header alone doesn't cap a
slow-drip or large-body response. Both guards are pure/testable without a real
network call (mock `global.fetch` returning a hand-rolled `ReadableStreamDefaultReader`).

### 2026-08-04 — the 2026-08-03 SSRF guard entry above was incomplete: `redirect: 'follow'` walks straight past `assertPublicHttpUrl`, no DNS control needed

`assertPublicHttpUrl` only validates the URL string it's called with — it's
never re-run against a redirect target. `fetchSkillText`
(`modules/skills/service.ts`) fetched with `redirect: 'follow'`, so a host
that passes the check on its own URL (e.g. `https://example.com/skill.md`)
could 302 to `http://169.254.169.254/latest/meta-data` and the fetch would
follow it with zero further validation — no DNS rebinding attack needed, just
one HTTP redirect. Caught by an automated PR review (branch
`feat/L02-page-conversation`), not by the existing unit tests, because every
test's mocked `fetch` returned a terminal response directly.

Fix: `redirect: 'manual'` + a loop that reads `res.headers.get('location')`,
resolves it against the current URL, re-validates it through
`assertPublicHttpUrl` before the next `fetch`, and bails past
`MAX_URL_REDIRECTS` hops (`modules/skills/constants.ts`). Any future
server-side fetch of a user-supplied URL needs the same treatment — passing
the SSRF guard once at the top is not enough if the fetch call itself is
allowed to follow redirects.

Same fix pass also closed a second gap in that code path: the `AbortController`
timeout was cleared in the `finally` right after `fetch()` resolved (i.e. once
headers arrived), but the response body was then read afterward via a manual
`getReader()` loop with no active timeout — a slow-drip body (each chunk under
`MAX_UPLOAD_BYTES` cumulative) could hold the request open indefinitely since
only the byte cap, not a time cap, applied during the read. Fix: keep the
timeout alive for the whole operation (`clearTimeout` moved to run after the
read loop, not after `fetch()`), so an abort during body-reading now also
throws the same "Timed out fetching…" `ValidationError`.

### 2026-08-04 — "restore an old version" needs no new persistence logic on top of an archive-then-bump versioning scheme — it's just `update`, sourced from history

Added `POST /skills/:id/restore` (`{ version }` in the body — matching the
literal route the PR reviewer's comment named, rather than the nested
`/skills/:id/versions/:version/restore` this first shipped with; both are
equally valid REST shapes, this repo just didn't have a precedent either way,
so when a human reviewer names a specific shape, match it over a
self-justified alternative). Flagged as missing by an
automated PR review on `feat/L02-page-conversation`; the client's
`VersionsTab.tsx` and `specs/02` had both explicitly documented "no restore in
v1" as a deliberate exclusion, not an oversight — an automated reviewer has no
visibility into that intent, so treat "missing endpoint" findings against a
documented v1 scope as a prompt to check specs/comments before assuming a gap).

`SkillsService.restoreVersion` (`modules/skills/service.ts`) is three lines:
look up the archived body via the existing `repo.getVersion`, then call
`this.update(workspaceId, id, { body: target.body })` — the same
archive-current/bump-version path a normal body edit already takes. No new
repository method, no new archive-write logic. Two edge cases fall out for
free from existing invariants rather than needing special-casing: (1)
restoring the CURRENT version 404s on its own, because `skill_versions` only
ever holds superseded bodies (see the `INITIAL_SKILL_VERSION` comment in
`constants.ts`) — the current version was never archived, so `getVersion`
correctly can't find it; (2) restoring drops you at a NEW version number
(v1 while at v2 → v3), never back to v1, because `update` doesn't know or
care that the body it received came from history instead of an editor —
history stays append-only with zero extra code to enforce it. When a feature
request is "let the user undo/revert an already-versioned entity," check
whether the existing edit path already produces the right append-only
semantics before reaching for new schema or a soft-delete/rewind concept.

### 2026-08-03 — findings attribution from `run_skills` is RUN-level, not skill-level, and the UI must say so

`run_skills` records which skills were injected into *a run's* prompt, not
which skill produced *which finding* — the model doesn't (yet) name a skill
per finding. So a run that injected four skills has all of its findings
counted toward all four skills' stats. This over-counts by design, and
`SkillsRepository`'s `findingCounts`/`findingsByCategory` comments call it out
explicitly so nobody "fixes" the over-count into a false precision the data
doesn't support. The Stats tab's panel title reflects this too: "Findings in
runs using this skill", never "caused by". If per-finding attribution is ever
wanted, it needs the `Review` schema to carry a skill reference per finding —
a real schema change, not a stats-query fix.

### 2026-08-03 — a reserved-but-unwired column can name the exact integration point for the feature that will fill it

`skills.evidenceFiles` had a code comment in `modules/skills/helpers.ts`
("stays null until the Conventions extractor") for a whole lesson before that
extractor existed. When it was time to populate it, the column existed but
`SkillsService.create`/`SkillsRepository.insert` had never threaded an
`evidenceFiles` field through — the DTO mapper (`toSkillDto`) already read it,
nothing ever wrote it. Threading one optional field through
`CreateSkillInput` → `InsertSkill` → the insert `.values()` was the entire
change; no schema migration needed, since the column had shipped speculatively
in spec 02's migration. When a column's comment names a future feature,
that's usually the whole integration contract, not just documentation.

**2026-08-04 addendum — the same pattern can reserve TWO different integration
points under the same word.** Implementing specs/05-intent-layer.md (L03,
`review_intent`) found `db/schema/reviews.ts`'s `pr_intent` table (columns:
`pr_id`, `intent`, `in_scope`/`out_of_scope` jsonb) plus a `pr_brief` table,
backed by `Intent`/`BlastRadius`/`Risks`/`PrHistory`/`SmartDiff`/`PrBrief`
contracts (`vendor/shared/contracts/brief.ts`, `review-api.ts`) and
`ReviewRepository.upsertIntent`/`getIntent` — all already fully wired
end-to-end at the repository layer, and all completely unused (zero routes,
zero other callers). Grepping "intent" makes this look like the obvious place
to land L03's work. It isn't: it's reserved for the LATER "PR Brief card"
lesson (README's roadmap: L04 Blast Radius, L05 PR Brief card), whose `Intent`
shape (`{intent, in_scope[], out_of_scope[]}`) is richer and serves a
different composed document. specs/05-intent-layer.md never references
`pr_intent` at all — it deliberately defines its own simpler cache (four
nullable columns directly on `pull_requests`) because there's nothing to
accept/reject or version for a single advisory string. Before wiring into a
same-named existing table/contract, confirm which `FeatureModelId` / which
lesson the spec in front of you actually targets — this codebase can reserve
more than one integration point under the same name for different lessons.

**2026-08-04 second addendum — implementing Smart Diff confirmed `SmartDiff`
does NOT need `pr_brief` after all, despite the addendum above grouping it
with `pr_intent` under the same "reserved for PR Brief card" umbrella.**
specs/06-smart-diff.md built `GET /pulls/:id/smart-diff` as fully
compute-on-read (`modules/reviews/smart-diff.ts`'s `buildSmartDiff`, called
from a new `ReviewService.smartDiff`) — no read or write of `pr_brief` at
all, deliberately, to avoid colliding with whatever the later PR Brief card
lesson still wants to do with that table. The `SmartDiff` zod contract
(`vendor/shared/contracts/brief.ts`) was itself the only "reservation" that
mattered here — it needed zero changes, matched the feature exactly, and
`ReviewRepository.getPrFiles`/`reviewsForPull` (both pre-existing, used by
`/pulls/:id/reviews`) were sufficient with no new repository method. Lesson
for whoever eventually builds the PR Brief card: don't assume `SmartDiff`'s
groups/`split_suggestion` still need to be composed into `pr_brief.json` just
because the contract sits in the same file as `PrBrief` — check what shipped
in specs/06 first.

**2026-08-25 addendum — the same pattern, but the whole response-envelope
contract was defined and never called anywhere, not one column.**
specs/14-export-to-ci.md's `CiPreview`/`CiTargetOption`/`CiRunsPage`/
`CiRefreshResult` (`vendor/shared/contracts/eval-ci.ts`) were fully specced,
identical in both `vendor/shared` copies, and had **zero** non-definition
references anywhere in `server/src` or `client/src` — every real route/hook
(`GET /ci/targets`, `POST /agents/:id/ci/preview`, `GET /ci/runs`,
`POST /ci/refresh`) was still returning/consuming a raw `CiTarget[]`/
`CiFile[]`/`CiRun[]`/ad hoc `{ingested, degraded}` shape instead of the named
contract sitting right next to it in the same file. A `plan-verifier` pass
caught this; grepping a contract's name for non-definition references (not
just confirming both copies match each other) is the check that would have
caught it earlier — "the two vendor/shared copies agree" only proves the
contract is well-formed, not that anything actually returns it. Fixed by
reshaping `CiService.listTargets/preview/listRuns/refresh` to build and
return the real envelope (`targets.ts` gained `listTargetOptions()`,
`bundle.ts` gained `toPreviewFiles()` for P-4's null-out-runner-bundle-
contents-in-preview behavior, `service.listRuns` now computes the
agent/repo filter vocabularies from the same read per AC-28).

### 2026-08-03 — `.dependency-cruiser-known-violations.json` baselines exact from→to edges, not files — narrowing a param type can silently add a new violation next to an already-ignored one

Changing `getFeatureModelOverride`/`resolveFeatureModel`
(`modules/settings/feature-models.ts`) to take `Db` instead of `Container` (to
break an import cycle — see the port-injection entry above) turned a
type-only `Container` import into a value import of `db/client.ts`. The file
already had a *grandfathered* `db-only-in-repositories` violation for
`db/schema.ts` on the same file, but the baseline matches on the literal
`to` path, so the new `db/client.ts` edge was NOT covered and failed `pnpm arch`
even though it's the same pre-existing class of debt (settings module reads
`t.settings` directly, bypassing a repository). Fix was `pnpm arch:baseline`
(regenerates the whole file) — diff it afterward (`git diff
.dependency-cruiser-known-violations.json`) to confirm it added only the one
expected edge and didn't silently swallow an unrelated new violation elsewhere
in the tree.

### 2026-08-04 — a debug log gated on `container.config.X` breaks every test that builds a partial mock `Container`

Adding `PROMPT_ASSEMBLY_DEBUG` (logs prompt-assembly section name/source/char-length
per run, metadata only, gated by `AppConfig.promptAssemblyDebugEnabled`) as a
plain `this.container.config.promptAssemblyDebugEnabled` check in
`run-executor.ts`'s `runOneAgent` broke 11 tests across 2 files immediately.
Cause: several tests (`test/skills-preview.test.ts` and one other) construct
`ReviewRunExecutor` with a hand-rolled `{ runBus, llm, tokenizer } as unknown
as Container` — no `config` key at all — so `.config.promptAssemblyDebugEnabled`
threw `Cannot read properties of undefined`. Fix: `this.container.config
?.promptAssemblyDebugEnabled` (optional-chain the `config` access itself, not
just the boolean). Generalizes: this codebase's test suite leans on
`as unknown as Container` casts that only populate the fields a given test
actually exercises — any new `container.config.<field>` read added to shared
executor code must optional-chain `config` defensively, or grep
`as unknown as Container` first to see which mocks would need updating
instead.

**2026-08-12 addendum — a NEW, non-optional `container.<getter>` read added to
`run-executor.ts` (not gated behind a debug flag) forces every hand-rolled
`as unknown as Container` mock to add that getter, not just optional-chain
it.** specs/09-project-context-folder.md's `resolveForRun` call
(`container.projectContextService.resolveForRun(...)`) is unconditional —
project context resolution runs on every agent, same as skills/repo-intel —
so `grep -rl "as unknown as Container" server/test` (3 hits at the time:
`test/prompt-skills.test.ts` x2 container literals, `test/skills-preview.test.ts`)
each needed `projectContextService: { resolveForRun: async () => ({
documents: [], entries: [] }) }` added, or the test fails with `Cannot read
properties of undefined (reading 'resolveForRun')` the moment `runOneAgent`
reaches that line — not a TS error (the cast bypasses the type checker
entirely), a runtime crash. Confirms the pattern generalizes beyond
optional-`config` reads above: ANY new required `container.<x>` dependency
`runOneAgent`/`executeRuns` reads needs the same `grep -rl "as unknown as
Container" server/test` sweep before the feature is done, and a one-line stub
per hit is enough (the tests in question aren't exercising that dependency).

### 2026-08-12 — a DevDigest review finding that names specific files as "missing from the diff" can be stale relative to the branch's actual current HEAD

PR #9's Test Quality Reviewer run (12/08/2026, 21:12:00) reported a CRITICAL
"missing server-side unit tests for the core project-context module," citing
`test/project-context-{paths,discovery,resolve}.test.ts` and
`test/project-context.it.test.ts` as absent from the diff, and describing the
only server test change as an `adhoc.test.ts` that mocks the resolver.
`git diff main...HEAD --stat` at the time of investigation showed all four
named files present, substantive (96–364 lines each), covering the plan's own
test matrix, and passing (36 tests standalone, 71 across the full
project-context-related file set) — and no `adhoc.test.ts` exists anywhere in
this repo. The finding was accurate for an EARLIER revision of the branch
(these test files were evidently pushed after that review run captured its
snapshot), not the one actually open for review. Before spending effort
writing tests/code to satisfy a DevDigest finding that cites specific file
paths as missing or absent, verify with `git diff <base>...HEAD --stat -- <the
cited paths>` first — a stale review run is indistinguishable from a real gap
until checked against the actual current diff, and re-running the review
after every push (not just once before opening the PR) is cheaper than
re-deriving what it already told you.

### 2026-08-15 — `repo-intel/service.ts`'s `isJunkPath` bare-substring-matched a tool name anywhere in the full path, silently dropping real source files from `getWeightedRankedFiles`

`isJunkPath` (used by `getWeightedRankedFiles` and, unfiltered, NOT by
`getCriticalPaths`'s weighted-order root selection — see the Open Questions
entry below) checked `JUNK_PATH_PATTERNS.some(p => path.toLowerCase()
.includes(p))` against the FULL path, with several patterns (`'eslint'`,
`'prettier'`, `'jest.'`, `'vitest.'`) having no directory/dot boundary at all.
A real, non-config, non-test source file like `src/eslint-plugin-custom/
index.ts` (an eslint-plugin package's own implementation) or `src/jest.
utils.ts` matched purely because the substring appeared in a directory name
or filename — misclassified as junk and silently excluded from
`allIndexedPaths`/`getWeightedRankedFiles`, with no error anywhere (a
test-quality-reviewer WARNING, 80% confidence, traced this from the onboarding
side — see `onboarding/facts.ts`'s `allIndexedPaths` comment). Confirmed by
writing the actual reviewer-suggested paths through the real function before
fixing anything.

Fix: split `JUNK_PATH_PATTERNS` into `JUNK_DIR_PATTERNS` (slash-delimited,
still full-path `.includes()` — safe, since a leading/trailing `/` can't match
inside an unrelated name) and `JUNK_BASENAME_PATTERNS` (checked only against
`path.slice(path.lastIndexOf('/') + 1)`), with the tool-name patterns
rewritten as anchored regexes matching known config-file shapes
(`^\.?eslint(rc)?(\.|$)`, `^jest\.(config|setup)\.`, etc.) instead of bare
substrings. `webpack.config.js`/`.eslintrc.js`/`jest.config.ts` still match;
`src/eslint-plugin-custom/index.ts`/`src/jest.utils.ts` no longer do. Lesson
for any future path-classification heuristic in this codebase: a
tool/framework name used as a bare substring pattern WILL eventually match a
real file that merely mentions the tool in its own name — anchor to the
basename (or a real extension/dot boundary) from the start, not after a
review catches it.

### 2026-08-15 — `getFileRankRows` had NO `ORDER BY` at all, not even a tiebreaker — an unordered `LIMIT` gives Postgres no obligation to return the same row SET twice, let alone the same order

The method's own doc comment correctly explains why it must NOT be `ORDER BY
rank DESC LIMIT n` (would bias `getWeightedRankedFiles`'s later re-sort by
excluding low-pagerank/high-churn files before they're ever weighted, AC-12)
— but the fix that shipped was to drop `ORDER BY` entirely rather than order
by something rank-independent. A test-quality-reviewer WARNING (80%
confidence) flagged this as "non-deterministic for ties"; the actual exposure
is broader than ties — without ANY `ORDER BY`, Postgres doesn't guarantee
which rows a `LIMIT` returns across repeated calls, not just their order (in
practice this can look stable for a while, since a heap-scan tends to return
rows in physical order absent a `VACUUM`/concurrent write — don't trust that
apparent stability). Fix: `.orderBy(asc(t.fileRank.filePath))` — alphabetical
by path is rank-independent (doesn't reintroduce the AC-12 bias) while making
the `LIMIT`'d row set and tie order deterministic. Generalizes: any query that
intentionally omits `ORDER BY` to avoid biasing a limit/sample should still
pick SOME deterministic tiebreaker column, never truly no order at all.

### 2026-08-21 — testing a workspace-scoped route with NO resource-id path param needs an `auth` override, not just DB rows in a second workspace

Building `test/ci-ingest.it.test.ts` (specs/14-export-to-ci.md, Phase D):
`getContext` (every route) resolves `workspaceId` via
`container.auth.currentWorkspace(req)` — **never** from a request param or
from whatever rows a test happens to insert. The default `LocalNoAuthProvider`
always resolves the ONE seeded workspace by name, cached per container
instance, regardless of what a test writes directly to `t.workspaces`. This is
invisible for routes keyed by a resource id (e.g. `brief.it.test.ts`'s AC-44
test creates a second workspace + PR and asserts `GET /pulls/:id/brief` 404s
for it — that works because the PR id alone, not the auth workspace, decides
which row is read) but breaks completely for a workspace-wide route with no
id at all (`POST /ci/refresh`, `GET /ci/runs`, `GET /agents/performance`): the
route will ALWAYS operate against the default seeded workspace no matter which
workspace the test's fixtures actually live in. Fix:
`overrides: { auth: new MockAuthProvider(undefined, { id: workspaceId, name: '...' }) }`
per `buildApp()` call, pointed at whichever workspace that test created.
Generalizes to any future test of a global/workspace-wide route (list,
refresh, aggregate) — check whether the route reads an id from the URL before
assuming "insert a second workspace + assert it's excluded" is enough on its
own.

Separately, `MockGitHubClient.listWorkflowRuns`/`listRunArtifacts`/
`downloadArtifact` (`src/adapters/mocks.ts`) ignore the `repo`/`RepoRef`
argument entirely — they return whatever fixture the test scripted regardless
of which installation is being queried. Since `CiService.refresh` iterates
EVERY `ci_installations` row in a workspace per call, two installations
sharing one workspace (or one workspace reused across several `it()` blocks in
the same file) get "refreshed" against the SAME mocked GitHub fixture on every
call — including the SAME provider `run.id` — which collides on `ci_runs`'
`(workspace_id, provider_run_id)` unique index and silently overwrites one
test's row with another's (`ciInstallationId` flips to whichever installation
processed last in that refresh's loop; `refresh()`'s `ingested` count also
inflates because it counts once per installation processed, not once per
resulting row). Fix: give every CI-ingest test its own freshly-created
workspace (`createWorkspace()` + a fresh agent + a fresh installation), never
share the seeded workspace or reuse one across cases in the same file.

## Session Notes

### 2026-08-26 — resuming `.worktrees/devdigest-ci` (`feat/export-to-ci`) after a context reset found the branch's last commit (`bfcc4dc`) unbuildable from a fresh checkout: several load-bearing files were still untracked

`git status --porcelain` looked routine — a handful of modified files, some
untracked ones — but the untracked set included `modules/ci/{ingest,manifest,
memory-export,ports,redact,refresh,routes}.ts` and `modules/memory/
repository.ts`, which `platform/container.ts` and `modules/index.ts` (both
already committed) import directly. So the tip commit was broken for anyone
who didn't happen to have these specific files sitting on disk from the prior
session — locally everything looked fine only because nothing had been
`git clean`ed. Confirmed the code itself was finished and correct (server +
client `pnpm typecheck` clean, `pnpm run arch` zero new violations, full
server suite 76 files/584 tests green, full client suite 43/230 green, plus
`verify:l07`'s dedicated ci-ingest integration test) before committing it as
`bcb3f4d`. Generalizes: after a context reset, or when picking up any
worktree from a prior session, don't judge "is this done" from `git status`
alone — grep the untracked filenames against already-committed source
(`grep -rl '<untracked-basename>' src`) to check whether tracked code already
depends on them. A clean-looking `git log` on its own is not evidence the
branch builds from a fresh clone.

### 2026-08-15 — a second round of test-writer passes (this time for `modules/onboarding/` and `modules/repo-intel/`) found the SAME stale-CRITICAL-premise pattern as the 2026-08-14 `modules/brief/` entry below, from the same DevDigest review run

Both a `test-writer` pass for `modules/onboarding/*` and one for
`modules/repo-intel/*` (dispatched together off the same Test Quality
Reviewer run that flagged brief/onboarding/repo-intel as three separate
CRITICAL "zero tests" blockers) found that onboarding, like brief the day
before, already had 44 unit tests + 4 integration tests committed in `3fee883`
before the pass started — only `repo-intel`'s NEW functions
(`getPrChurn`/`getFileRankRows`/`getFileFacts`, modified
`getCriticalPaths`/`computeFileRank`/pipelines) were genuinely untested, as
claimed. Net: of three CRITICAL findings from one review run, two were stale
and one was real — reinforces the 2026-08-12 entry's advice to verify each
cited file individually (`git log --oneline -- <path>`) rather than trusting
or dismissing an entire multi-file review finding as a unit.

Two WARNING findings from the same run were investigated with real
reproductions rather than taken on faith, and BOTH turned out real — see the
two 2026-08-15 Recurring Errors & Fixes entries above (`isJunkPath` basename
anchoring, `getFileRankRows` missing `ORDER BY`) — while a third WARNING
(`getCriticalPaths`'s weighted-root selection reading unfiltered `file_rank`
rows) reproduced but was left as-is: it's pre-existing (present in the
default `rank` ordering too, not introduced by this branch) and already
self-documented in `getWeightedRankRows`'s own doc comment as deliberate,
so it's a product/triage question, not a bug. General lesson: when a batch of
review findings arrives together, triage each one on its own evidence
(re-run the actual code with the reviewer's example) rather than applying one
verdict (stale / real / not-a-bug) to the whole batch.

### 2026-08-14 — test-writer pass for `modules/brief/` (specs/11): the task brief's own premise ("zero tests, CRITICAL blocker") was stale, same class of staleness as the 2026-08-12 entry below but from a task description this time, not a DevDigest run

Invoked to add unit tests for `server/src/modules/brief/*` on the claim that
the implementation "landed with ZERO tests". `git log --oneline -- <path>`
against each `brief-*.test.ts` file showed they were already committed in
`cd0dfb0` (the implementer's own commit) and extended in `7da9338` (a prior
backfill pass) — 74 passing unit tests across hunks/facts/prompts/grounding/
service plus a full `brief.it.test.ts` integration suite (real Postgres via
testcontainers, `MockLLMProvider`), covering nearly every row of
`plans/11-why-risk-brief.md`'s Verification test matrix. Running the existing
suite before writing anything new (`pnpm exec vitest run test/brief-*.test.ts
test/contracts.test.ts`) confirmed all green. Lesson: a task brief naming
specific files as "untested" is exactly as capable of being stale as the
DevDigest-review-finding case already documented below — verify with
`git log -- <path>` and a real test run before trusting the premise, not just
for automated review findings.

Real, narrower gaps found and filled by diffing the actual test files against
`plans/11`'s Verification matrix row-by-row (all additions, zero production
edits): (1) `hunks.ts`'s malformed-header shapes (missing the `+`/new-file
half, missing the closing `@@`, an `@@` appearing mid-line rather than at line
start) had no test — added to `test/brief-hunks.test.ts`, all correctly yield
zero ranges. (2) `grounding.ts`'s `scanCitations` (AC-18) only had a test for
its endpoint-mention branch; the backtick-quoted symbol and 5-field-cron-shape
branches, and the "a backtick token matching a known file is left untouched"
case, were completely untested — added to `test/brief-grounding.test.ts`.
(3) `clone.ts`'s `readSpecFile` had **zero direct tests** — it was only ever
exercised indirectly through `facts.ts` tests injecting a stub `readSpec`
callback, so its own containment/oversized-file/directory/missing-file
branches were unverified. New `test/brief-clone.test.ts`, modeled on
`test/project-context-paths.test.ts`'s real-tmpdir-fixture style (mkdtemp +
symlink-escape), covers all five failure modes degrading to `null` per AC-7.
(4) `schemas.ts`'s Q4 design decision (`plans/11-why-risk-brief.md`'s
`risk.kind: z.string()`, deliberately NOT the shared `RiskKind` enum, so an
invented kind normalises in `grounding.ts` rather than failing schema
validation and burning a repair attempt) had no test proving that specific
parse behavior — new `test/brief-schemas.test.ts`.

Reusable gotcha surfaced while writing a "top-ranked callers survive the
budget drop" test for `prompts.ts`: `renderBlast`'s caller-trim
(`b.callers.slice(0, flags.callersLimit)`, `prompts.ts`) does **not** itself
sort by rank — it trusts that `facts.ts`'s `deriveBlastFact` already sorted
`blast.callers` descending by rank before `buildBriefMessages` ever sees the
`BriefFactSet`. A fixture built directly (bypassing `assembleFacts`, the
pattern every existing `brief-prompts.test.ts` fixture already uses) with
callers in ascending rank order failed the assertion — not a product bug,
just the fixture violating an invariant that only `facts.ts`'s doc comment
states and nothing in `prompts.ts`'s own types enforces. Fix: pre-sort the
fixture descending by rank, matching what `deriveBlastFact` actually
produces. Any future `prompts.ts` test that hand-builds a `BriefFactSet`
(rather than calling `assembleFacts`) must pre-sort `blast.callers` itself or
a "top-N survives" assertion will fail for the wrong reason.

Full unit lane (`pnpm exec vitest run --exclude '**/*.it.test.ts'`): 49 files
/ 407 tests green. `test/brief.it.test.ts` (Docker was available): 4/4 green.
`pnpm typecheck` and `pnpm arch`: both clean, zero new violations.

### 2026-08-12 — test-writer backfill for specs/09: a plan's own Verification test matrix can name rows the implementer never actually covered

Cross-checking plans/09-project-context-folder.md's server test matrix against
the tests the two `implement-plan` passes actually landed found two real,
literal gaps despite `plan-verifier` PASS + clean `architecture-reviewer`:
(1) `ProjectContextService.resolveCandidates`'s `unreadable`/`not_a_file`
`SkipReason`s (`modules/project-context/service.ts`) had zero test coverage —
only `missing`/`no_checkout`/`repo_mismatch`/`refused_containment`/
`budget_drop` were exercised in `test/project-context-resolve.test.ts`, even
though the matrix row literally lists "deleted/unreadable/no-checkout/
wrong-repo". (2) The matrix's "token parity: a document and a skill body of
identical text report identical counts (AC-6)" row had no test that actually
compared the two — existing tests proved the tokenizer is *injected*, not
that a document's count equals a skill body's count for the same text through
the same real tokenizer. Backfilled all three in `project-context-resolve.
test.ts`. General lesson: `plan-verifier`/`architecture-reviewer` check that
code matches the plan's *approach*, not that every row of its own Verification
test matrix has a corresponding assertion — a `test-writer` pass needs to
re-derive the matrix and grep for each row's AC-id/behavior by name, not trust
that "tests exist for this module" means "this row is covered".

Reusable technique: testing an `unreadable` (permission-denied) failure path
needs `chmod(target, 0o000)` PLUS a `process.platform === 'win32' ||
process.getuid?.() === 0` skip guard — root (common in a Docker-based CI
runner) and Windows both bypass POSIX read-permission bits, so the test would
silently prove nothing (not fail, just never hit the code path) without the
guard. `not_a_file` needs no such guard — attaching a path that resolves to a
real directory (`mkdir` instead of `writeFile`) is portable and deterministic.

## Open Questions

### 2026-08-14 — three underspecified judgment calls in `modules/brief/` (specs/11-why-risk-brief.md), left documented rather than blocking implementation

AC-18 ("IF a brief names an endpoint, cron or symbol that is not present in
the fact set's blast-radius facts, THEN drop that citation") has no
structured field to enforce against — the raw schema (`brief/schemas.ts`) only
has `file_refs`, not a separate endpoint/cron/symbol list. `brief/
grounding.ts`'s `scanCitations` implements this as a text-pattern heuristic:
a bare `METHOD /path` mention is redacted to `METHOD an endpoint` when absent
from `knownEndpoints`; a backtick-quoted token matching a bare identifier or a
5-field cron shape is checked against `knownSymbols`/`knownCrons` and the
backticks stripped (visible text kept) when absent. This can both false-
positive (an English word that happens to look like a cron expression) and
false-negative (a citation phrased without backticks/METHOD prefix) — it is
NOT exhaustive text understanding, by design. If this proves too noisy in
practice, the fix is a structured citations field on the raw schema (model
explicitly lists endpoints/crons/symbols it's asserting), not a smarter regex.

`groundBrief(raw, facts)` grounds against the FULL `BriefFactSet` (same object
`prompts.ts` rendered from), not a reduced "what actually survived this
generation's budget drop" subset — deliberately mirroring `onboarding/
grounding.ts`'s `groundTour(result.data, facts)`, which does the same. A
citation to something real but dropped from the rendered payload for budget
reasons (e.g. caller #21, past the top-20 cutoff) is NOT rejected — it's
statistically unlikely (the model wasn't shown it) but not impossible if it
guesses right, and is not treated as a bug.

`pr_brief.dropped_inputs` (AC-8) counts DROP CATEGORIES applied (0-6, one per
`prompts.ts` `DROP_STEPS` entry), not individual dropped items (not "14
callers omitted"). `buildBriefMessages`'s `RenderedBriefPayload.droppedCount`
is the source of this number — read that if a future UI wants a more granular
count; the column would need a shape change (int → object) to carry it.
