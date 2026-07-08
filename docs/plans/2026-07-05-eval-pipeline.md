# Development Plan: Eval Pipeline

**Date:** 2026-07-05
**Requirements:** [docs/feature-requirements/2026-07-05-eval-pipeline.md](../feature-requirements/2026-07-05-eval-pipeline.md) (Status: draft; SPEC-2026-07-05-eval-pipeline)
**Execution mode:** multi-agent
**Scope:** full-stack
**Affects modules:** `server/src/modules/eval/` (new), `server/src/db/schema/eval.ts` (extended via new migration), `server/src/db/migrations/` (new numbered migration), `server/src/vendor/shared/contracts/` (new additive file), `client/src/vendor/shared/contracts/` (mirrored copy), `client/src/app/agents/[id]/_components/AgentEditor/` (new EvalsTab), `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/` (new action), `client/src/lib/hooks/` (new `eval.ts`), `server/src/db/seed.ts` (extended), `server/package.json` (new `verify:l06` script)

---

## 1. Context

An agent author who edits a reviewer agent's prompt, model, or skills today has no regression signal — they must manually re-run the agent over past PRs and eyeball findings. This feature gives every agent a fixed, versioned set of eval cases (`must_find` / `must_not_flag` expectations tied to file/line ranges), lets the author re-run the agent over that set on demand as a **batch** (one agent-snapshot identity, one run per case), and computes three deterministic, zero-LLM-call metrics (recall, precision, citation accuracy) per batch, with history, trend, and side-by-side comparison. Cases are created either in one click from an already-accepted/dismissed finding, or hand-authored in a Case Editor with a pasted diff fragment.

The `eval_cases` and `eval_runs` tables already exist in the schema but the `eval` module is not registered anywhere — this plan builds and registers it, adds one new table (`eval_batches`) plus one new nullable column (`eval_runs.batch_id`) via a single new migration, and wires a new Evals tab into the existing Agent Editor.

## 2. Architecture Fit

New Fastify plugin module `server/src/modules/eval/` following the standard 3-layer pattern (`routes.ts` / `service.ts` / `repository.ts` / `helpers.ts`), registered statically in `server/src/modules/index.ts` alongside the other L02–L08 modules.

- **Presentation** (`eval/routes.ts`): case CRUD routes, "create case from finding" route, run routes (full-set + single-case, sharing one handler), batch history/trend/compare read routes. All under `getContext(container, req)` for workspace resolution.
- **Application** (`eval/service.ts` + `eval/scoring.ts` + `eval/run-orchestrator.ts`): case validation (unified-diff parse gate for AC-7/AC-8), batch orchestration (agent-snapshot fingerprinting, per-case `reviewPullRequest()` invocation via the SAME call type already used for real reviews, rate-limit/concurrency enforcement), deterministic scoring (recall/precision/citation-accuracy — pure functions, zero I/O, zero LLM calls), flaked-status computation, trend/compare read-side composition.
- **Infrastructure** (`eval/repository.ts`): Drizzle queries against `eval_cases`, `eval_runs`, `eval_batches` — every case query scoped by `eval_cases.workspace_id`; every run/batch query joins transitively through `eval_cases`/`eval_batches`'s owning workspace (AC-36; `eval_runs` and `eval_batches` carry no direct workspace column per the spec — `eval_batches` does get one, since it is a NEW table with no "never alter" constraint blocking it; see Step 1).
- **New DB migration** `0016_eval_batches.sql`: `CREATE TABLE eval_batches` + `ALTER TABLE eval_runs ADD COLUMN batch_id` (nullable FK) — additive only, no existing column touched.
- **New shared contract file** `contracts/eval-batch.ts` (additive, NOT modifying `eval-ci.ts`'s existing `EvalCaseInput`/`EvalRunResult`/`EvalDashboard`/`EvalTrendPoint` — those stay untouched and unused by this feature, reserved for a possible future workspace-wide dashboard per the spec's Non-goals).
- **Client**: new `EvalsTab` component following the existing `SkillsTab`/`ContextTab` pattern, added as a 4th entry in `AgentEditor`'s `TABS` array; new `CaseEditor` modal/panel component; a new "→ eval case" action added to `FindingCard.tsx`'s existing action bar; new `client/src/lib/hooks/eval.ts` React Query hooks mirroring the `hooks/agents.ts` pattern.
- **Reused, not modified**: `reviewer-core`'s `reviewPullRequest()` (AC-13 — the exact same call type, invoked with a case's stored diff fragment instead of a real PR diff; zero new LLM call sites), `groundFindings()`'s citation gate output (`ReviewOutcome.review.findings` = kept, `ReviewOutcome.dropped` = dropped — citation accuracy is computed by counting these, never by re-invoking grounding), `server/src/adapters/git/diff-parser.ts`'s `parseUnifiedDiff()` (reused for both the Case Editor's AC-7/AC-8 validation gate and for AC-5's "capture only this finding's file's hunk(s)" extraction).

## 3. Skills & Patterns Applied

**`backend-onion-architecture`:**
- New module = 3-layer plugin (routes/service/repository), statically registered — no auto-discovery (R7).
- Every repository query scoped by `workspace_id` — `eval_cases` directly; `eval_runs`/`eval_batches` joined transitively (R1, AC-36).
- Adapters via `container` only — LLM access goes through the existing `reviewPullRequest()` call, which itself receives an `LLMProvider` resolved by the caller (the service resolves the agent's configured provider via `container.llm(agent.provider)`, mirroring `run-executor.ts`'s existing pattern) — never a new concrete adapter import in `eval/service.ts` (R2).
- `AppError`/`NotFoundError`/`ValidationError` for all expected failures — never raw `Error` (R3).
- Module import isolation (R6): `eval/` does not import from `reviews/`, `agents/`, or `findings.ts` internals directly. Cross-module needs (resolving an agent's config, resolving a finding's diff/PR) go through `container` facades or a small new `container.agents`-style accessor — see Step 3 for the exact mechanism, following the `container.blast`/`container.contextDocs` getter-facade precedent already established in `platform/container.ts`.

**`typescript-expert`:**
- `z.infer`/`z.input` pairing for all new Zod contracts (`EvalCaseInput` vs. its input type, per existing `ComposeReviewInput`/`ComposeReviewInputBody` precedent in `eval-ci.ts`).
- Discriminated unions for batch `kind` (`full | calibration`) and case `last_run_status` (`never_run | passed | failed | error | flaked`) — exhaustive switches in the service layer, never string comparison chains.
- `noUncheckedIndexedAccess` is on in `server/tsconfig.json` — any `Record`/array index access in the scoring logic (matching findings against expectations) must handle `T | undefined` explicitly (see the `server/insights.md` 2026-07-03 Quirk entry on this exact pitfall).

**`zod`:**
- One schema drives both route validation and TS types (`fastify-type-provider-zod`).
- `schema-use-enums` for `owner_kind`, batch `kind`/`status`, expectation `type`.
- `parse-use-safeparse` for the Case Editor's diff-fragment validation path (AC-7/AC-8) — return a structured issue list, never throw past the boundary.

**`drizzle-orm-patterns`:**
- New table via `pgTable()` in `server/src/db/schema/eval.ts`, `defaultRandom()` uuid PK, `references(() => ..., { onDelete: 'cascade' })` for FKs, matching every existing table in that file.
- `db.transaction()` only if a step needs atomic multi-row writes (batch row + N run rows) — see Step 4.

**`postgresql-table-design`:**
- `eval_batches.agent_snapshot` as `JSONB NOT NULL` (opaque fingerprint object) — GIN index not needed (never queried by content, only stored/displayed).
- `TIMESTAMPTZ` for `ran_at` (already the existing convention via the `now()` helper in `_shared.ts`).
- `doublePrecision` for recall/precision/citation_accuracy (matches `eval_runs`'s existing columns exactly — do not introduce `NUMERIC` inconsistently).
- FK column `eval_runs.batch_id` gets an explicit index (Postgres does not auto-index FK columns).

**`react-best-practices`:**
- `EvalsTab` composed of small presentational sub-components (`CaseList`, `CaseRow`, `BatchHistoryTable`, `TrendChart`, `BatchCompare`) — max 200 lines each, container fetches via hooks, presentational components receive props only.
- All eval-run mutations (`useRunBatch`, `useRunSingleCase`, `useCreateCase`, `useDeleteCase`) live in `client/src/lib/hooks/eval.ts` — never inline `fetch` in a component.
- Derive `last_run_status` display strictly from server-provided `last_run_status` field — no client-side re-derivation of pass/fail.

**`next-best-practices`:** not directly triggered (no new route segment, no Server Component/Server Action boundary crossed — the Evals tab is a client-side tab inside the existing `agents/[id]` client page).

**`frontend-architecture`:**
- `EvalsTab` and its sub-components live co-located under `AgentEditor/_components/EvalsTab/`, matching the existing `SkillsTab`/`ContextTab` sibling structure — no premature promotion to `shared/`.
- `CaseEditor` is feature-scoped to `EvalsTab/_components/CaseEditor/` unless/until a second consumer needs it.

**`security`:**
- A03/Injection surface: pasted diff fragments (Case Editor) and finding-derived diff hunks are the same trust class as a real PR diff already routed through the existing prompt-assembly wrapping (`assemblePrompt()`'s `<untrusted>` delimiting + `INJECTION_GUARD`) — processed as data only. No new sanitization layer needed; reuse the existing wrapping path, never bypass it.
- A05/XSS: case `name`/`notes` free text rendered back in the UI — React JSX auto-escaping is the existing safety net (per spec §10); no `dangerouslySetInnerHTML` anywhere in `EvalsTab`.
- A06/Insecure Design (rate limiting): the eval-run route (`POST /agents/:id/evals/run`) gets `rateLimit: { max: 2, timeWindow: '1 minute' }` (matches `review-all` exactly, per the user's confirmed Q3 answer) plus an in-process `scheduleNext()` concurrency cap of 3 concurrent case-runs within one batch (mirrors `reviews/routes.ts`'s existing pattern verbatim).
- A01/Broken Access Control: every eval route resolves `workspaceId` via `getContext()` and the repository enforces workspace scope on every query — cross-workspace requests behave as not-found, never leak data (AC-36, edge case table row "Cross-workspace request").

## 4. Project Constraints

- **New Fastify plugin module, statically registered** — `eval/routes.ts` added to `server/src/modules/index.ts`'s `modules` record; no auto-discovery exists in this codebase.
- **Adapters only via `container`** — the eval run orchestrator never imports a concrete `LLMProvider`/`OpenAIProvider` class; it resolves via `container.llm(agent.provider)` exactly as `run-executor.ts` already does.
- **Every repository query workspace-scoped** — `eval_cases.workspace_id` directly; `eval_runs`/`eval_batches` reads join through `eval_cases`/`eval_batches.workspace_id` respectively (the new `eval_batches` table DOES get its own `workspace_id` column — see Step 1 — because it is a brand-new table, not a modification of the existing `eval_runs`, which is left exactly as-is except for the additive nullable `batch_id` column).
- **`AppError` for all expected failures** — `NotFoundError` for missing case/agent/batch, `ValidationError` for a malformed diff fragment (AC-8) or an empty required field.
- **Secrets via `SecretsProvider` only** — not directly touched by this feature (no new secret type introduced); the existing `container.llm(...)` resolution already handles provider API keys internally.
- **Shared types added to `server/src/vendor/shared/` AND mirrored into `client/src/vendor/shared/` in the SAME step** — per the repeatedly-documented insight that these are two physically separate file trees with no sync script; a plan step that edits only the server copy silently breaks client typecheck until manually mirrored. Step 1 owns both copies together.
- **DB schema changes only via a new numbered migration; never alter an existing column** — migration `0016_eval_batches.sql` only `CREATE TABLE`s and `ADD COLUMN`s (nullable, no rewrite of existing rows required). `eval_cases`/`eval_runs`'s existing columns are never touched.
- **`reviewer-core` stays side-effect-free** — no new code is added to `reviewer-core/`; the eval module calls the existing exported `reviewPullRequest()` from the server side exactly as `run-executor.ts` does. Deterministic scoring (recall/precision/citation-accuracy) is NEW code but lives in `server/src/modules/eval/scoring.ts`, not in `reviewer-core`, since it is eval-specific post-processing over an already-produced `ReviewOutcome`, not a change to the review engine itself.
- **Grounding is mandatory, never bypassed** — citation accuracy is computed by counting `ReviewOutcome.review.findings` (survived `groundFindings()`) vs. the pre-grounding total (`review.findings.length + dropped.length`) — the scoring code reads the outcome of the mandatory gate, it never calls `groundFindings()` itself or re-implements grounding logic.
- **Rate-limit/concurrency precedent reuse** — 2 req/min, concurrency cap 3, per the user's confirmed answer, matching `POST /repos/:id/review-all` exactly (same numbers, same `scheduleNext()` pattern).
- **Idempotent seed** — the 5 hand-authored demo cases in `seed.ts` use `onConflictDoNothing()` keyed on a stable deterministic identifier (a fixed UUID literal per case, following the existing `onConflictDoNothing()` convention already used 6+ times in `seed.ts`), so re-running `pnpm db:seed` never duplicates them (AC-39).

## 5. Implementation Steps

**Parallelization map:**
```
Wave 1a: Step 1 (migration + schema)  ∥  Step 2 (shared contracts, server+client)
Wave 1b: Step 3 (repository)          ∥  Step 4 (scoring — pure functions, no repo dependency)
Wave 1c: Step 5 (service + run-orchestrator)   [depends on 1a, 1b]
Wave 1d: Step 6 (routes + module registration) [depends on 1c]
Wave 2:  Step 7 (client hooks)  ∥  Step 8 (EvalsTab UI)  ∥  Step 9 (FindingCard action)
         [all depend on Wave 1d's routes/contracts]
Wave 3:  Step 10 (seed data)  ∥  Step 11 (verify:l06 script + scoring/rate-limit tests)
         [Step 10 depends on Wave 1d; Step 11 depends on Wave 1's server code existing]
```

Note: Step 7/8/9 are listed as one wave because their owned paths are disjoint (`lib/hooks/eval.ts` vs. `AgentEditor/_components/EvalsTab/` vs. `FindingCard/`), but Step 8 imports the hooks Step 7 creates — if run by different implementer instances truly in parallel, Step 8's implementer must stub the hook import shape from this plan's Step 7 contract (exact function signatures are specified below) rather than waiting; if the orchestrator prefers strict safety here, Step 7 can be promoted to Wave 1e-equivalent (run just before 8/9). Recommendation: run Step 7 first within Wave 2 if the multi-agent scheduler supports intra-wave ordering; otherwise widen to Wave 2 as shown since the hook signatures are fully pinned in Step 7's spec below.

---

### Step 1: Database migration — `eval_batches` table + `eval_runs.batch_id` column

**Dependencies:** none
**Owned paths:** `server/src/db/schema/eval.ts`, `server/src/db/migrations/0016_eval_batches.sql`, `server/src/db/migrations/meta/0016_snapshot.json`, `server/src/db/migrations/meta/_journal.json`

**What to do:**
1. In `server/src/db/schema/eval.ts`, add a new `evalBatches` table definition:
   ```
   export const evalBatches = pgTable('eval_batches', {
     id: uuid('id').primaryKey().defaultRandom(),
     workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
     agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
     kind: text('kind', { enum: ['full', 'calibration'] }).notNull(),
     status: text('status', { enum: ['clean', 'degraded'] }), // nullable — calibration batches use a comparable per-case status without this label (per spec Contracts section)
     agentSnapshot: jsonb('agent_snapshot').notNull(),
     recall: doublePrecision('recall'),
     precision: doublePrecision('precision'),
     citationAccuracy: doublePrecision('citation_accuracy'),
     costUsd: doublePrecision('cost_usd'),
     ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
   });
   ```
   Import `agents` from `./agents` at the top of the file (new import needed — `eval.ts` currently imports only `workspaces` and `pullRequests`).
2. Add `batchId: uuid('batch_id').references(() => evalBatches.id, { onDelete: 'set null' })` as a new nullable column on the existing `evalRuns` table definition — append it, do not reorder or touch any existing column.
3. Run `cd server && pnpm db:generate` to emit `0016_eval_batches.sql` + its matching `meta/0016_snapshot.json` + `_journal.json` entry. Inspect the generated SQL: it must contain exactly one `CREATE TABLE eval_batches` and one `ALTER TABLE eval_runs ADD COLUMN batch_id` — no other table's DDL. If drizzle-kit emits anything else (e.g. attempts to touch `eval_cases`), stop and diagnose before proceeding (per the `server/insights.md` 2026-07-03 entries on snapshot-chain drift — verify the snapshot chain is clean with a dry run first if `db:generate` complains about a collision).
4. Add an explicit index on `eval_runs.batch_id` (Postgres does not auto-index FK columns) — either let drizzle-kit emit it if the schema declares `.references()` with an index hint, or append a manual `CREATE INDEX IF NOT EXISTS eval_runs_batch_id_idx ON eval_runs(batch_id);` to the generated migration file. Also add `CREATE INDEX IF NOT EXISTS eval_batches_agent_id_idx ON eval_batches(agent_id);` and `CREATE INDEX IF NOT EXISTS eval_batches_workspace_id_idx ON eval_batches(workspace_id);` for the read-side queries Step 3 will need (batch history per agent, workspace-scoped case listing).
5. Run `cd server && pnpm db:migrate` against the local dev DB to apply and confirm no errors.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm db:migrate` applies cleanly against a fresh or existing dev DB
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d eval_batches"` shows the new table with all columns and indexes
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d eval_runs"` shows the new nullable `batch_id` column; all pre-existing columns unchanged

**Commit:** `feat(db): add eval_batches table and eval_runs.batch_id column (0016)`

---

### Step 2: Shared contracts — batch, trend point, case-list-item shapes (server + client, mirrored)

**Dependencies:** none
**Owned paths:** `server/src/vendor/shared/contracts/eval-batch.ts` (new), `client/src/vendor/shared/contracts/eval-batch.ts` (new, mirrored copy), `server/src/vendor/shared/index.ts` (barrel export addition), `client/src/vendor/shared/index.ts` (barrel export addition)

**What to do:**
1. Create `server/src/vendor/shared/contracts/eval-batch.ts` — additive only, does NOT modify `eval-ci.ts`'s existing `EvalCaseInput`/`EvalRunRecord`/`EvalRunResult`/`EvalTrendPoint`/`EvalDashboard` (those stay as dead-but-untouched code, reserved for a possible future feature). Define, using `z.object` + `z.infer`/`z.input` pairing per the existing `eval-ci.ts` pattern:
   - `Expectation`: `{ type: z.enum(['must_find','must_not_flag']), file: z.string(), line_start: z.number().int(), line_end: z.number().int(), severity: z.string().nullish(), kind: z.string().nullish() }`
   - `EvalCaseSource`: `z.enum(['finding','manual'])`
   - `EvalCaseListItem` (the case-list contract from spec §9): `{ id, owner_id, name, source: EvalCaseSource, source_finding_id: z.string().nullish(), source_pr_number: z.number().int().nullish(), expected_output: z.array(Expectation), last_run_status: z.enum(['never_run','passed','failed','error','flaked']), last_run_summary: z.string().nullish() }`
   - `EvalCaseCreateInput`: `{ owner_id: z.string(), name: z.string().min(1), input_diff: z.string(), expected_output: z.array(Expectation), notes: z.string().nullish() }` — used by the manual Case Editor's save action (AC-7).
   - `EvalCaseFromFindingInput`: `{ finding_id: z.string() }` — used by AC-1's one-click action; server resolves everything else (file/line/severity/category/diff-hunk/expectation-type) from the finding record itself.
   - `EvalBatchKind`: `z.enum(['full','calibration'])`
   - `EvalBatchStatus`: `z.enum(['clean','degraded'])`
   - `EvalBatch` (spec §9 "Batch"): `{ id, agent_id, kind: EvalBatchKind, status: EvalBatchStatus.nullable(), agent_snapshot: z.unknown(), recall: z.number().nullable(), precision: z.number().nullable(), citation_accuracy: z.number().nullable(), cost_usd: z.number().nullable(), ran_at: z.string() }`
   - `EvalBatchCaseOutcome` (per-case row inside a batch, needed for AC-33's drill-down and AC-32's compare): `{ case_id, case_name, status: z.enum(['passed','failed','error']), expected_count: z.number().int(), matched_count: z.number().int(), findings_count: z.number().int(), cost_usd: z.number().nullable() }`
   - `EvalBatchDetail`: `EvalBatch.extend({ cases: z.array(EvalBatchCaseOutcome), excluded_skill_owned_count: z.number().int() })` (AC-2's visible-exclusion count travels with any listing/run response).
   - `EvalTrendPointV2`: `{ batch_id, ran_at, recall: z.number(), precision: z.number(), citation_accuracy: z.number(), is_degraded: z.boolean(), agent_snapshot: z.unknown(), cost_usd: z.number().nullable() }`
   - `EvalRunBatchRequest`: `{ case_ids: z.array(z.string()).nullish() }` — omitted/absent → full-set run; present with a strict subset → calibration batch (AC-14).
   - `EvalBatchCompareResult`: `{ a: EvalBatchDetail, b: EvalBatchDetail, deltas: { recall: z.number(), precision: z.number(), citation_accuracy: z.number() } }`
2. Export all new types/schemas from `server/src/vendor/shared/index.ts`'s barrel (add to the existing export list — check the barrel first for any naming collision, per the `server/insights.md` 2026-06-30 `AgentStats` collision Mistake entry; none of the names above collide with any existing export based on the codebase scan in this plan's research phase, but re-verify at implementation time).
3. Copy the exact same file content into `client/src/vendor/shared/contracts/eval-batch.ts` and add the same barrel export line to `client/src/vendor/shared/index.ts` — this is a manual mirror, not a build-time link (per the repeatedly-documented client/server `vendor/shared` divergence risk). Do this in the SAME step/commit so no intermediate commit has a typecheck-broken client.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck` AND `cd client && pnpm typecheck`)
- [ ] `grep` confirms no duplicate export name exists in either barrel before adding (`grep -rn "EvalBatch\b" server/src/vendor/shared/contracts/` returns only the new file)
- [ ] The two `eval-batch.ts` files are byte-identical (`diff server/src/vendor/shared/contracts/eval-batch.ts client/src/vendor/shared/contracts/eval-batch.ts` — no output)

**Commit:** `feat(shared): add eval-batch contracts (case list, batch, trend, compare)`

---

### Step 3: Repository — `eval/repository.ts`

**Dependencies:** Step 1 (schema), Step 2 (contract types for return-shape mapping)
**Owned paths:** `server/src/modules/eval/repository.ts` (new)

**What to do:**
1. Create `EvalRepository` class, constructor takes `Db` (matches the canonical pattern — repositories are instantiated with `container.db`, never the full `Container`).
2. Implement, each query workspace-scoped:
   - `listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]>` — `SELECT * FROM eval_cases WHERE workspace_id = $1 AND owner_kind = 'agent' AND owner_id = $2`.
   - `countSkillOwnedCases(workspaceId: string): Promise<number>` — `SELECT COUNT(*) FROM eval_cases WHERE workspace_id = $1 AND owner_kind = 'skill'` (feeds AC-2's visible-exclusion count).
   - `getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | null>`.
   - `insertCase(data: InsertEvalCase): Promise<EvalCaseRow>`.
   - `deleteCase(workspaceId: string, caseId: string): Promise<boolean>`.
   - `latestRunForCase(caseId: string): Promise<EvalRunRow | null>` — used to compute `last_run_status`/`last_run_summary` per case (AC-25, AC-26).
   - `lastThreeFullBatchOutcomesForCase(caseId: string, agentId: string): Promise<('passed'|'failed'|'error')[]>` — feeds AC-27's flaked-detection (join `eval_runs` → `eval_batches` filtered to `kind='full'`, ordered by `ran_at DESC`, limit 3).
   - `insertBatch(data: InsertEvalBatch): Promise<EvalBatchRow>`.
   - `insertRun(data: InsertEvalRun): Promise<EvalRunRow>` — includes the nullable `batch_id`.
   - `updateBatchAggregate(batchId: string, metrics: { recall, precision, citationAccuracy, costUsd, status }): Promise<void>` — called once all case-runs in a batch complete.
   - `listBatchHistory(workspaceId: string, agentId: string): Promise<EvalBatchRow[]>` — `WHERE workspace_id = $1 AND agent_id = $2 ORDER BY ran_at DESC` (AC-33).
   - `listTrendBatches(workspaceId: string, agentId: string): Promise<EvalBatchRow[]>` — same but `WHERE kind = 'full'` only (AC-28).
   - `getBatch(workspaceId: string, batchId: string): Promise<EvalBatchRow | null>` — for compare/drill-down (AC-32).
   - `runsForBatch(batchId: string): Promise<EvalRunRow[]>` — per-case outcomes for a batch detail view.
   - `previousFullBatch(workspaceId: string, agentId: string, beforeRanAt: string): Promise<EvalBatchRow | null>` — `WHERE kind='full' AND ran_at < $3 ORDER BY ran_at DESC LIMIT 1` (AC-31's "skip calibration batches" delta baseline).
3. All methods take `workspaceId` as an explicit parameter and include it in every `WHERE` clause, per R1 — no exceptions, including on the `eval_batches`/`eval_runs` joins (join through `eval_batches.workspace_id` since that table now carries its own workspace column per Step 1).
4. Do not import `service.ts` or any other module's repository — infrastructure-only, no business rules (e.g., no flaked-status *decision* logic here beyond returning the raw last-3 outcomes array; the decision belongs in `service.ts`).

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Hermetic test file `server/test/eval-repository.test.ts` (new, written alongside this step per the module's testing convention) exercises each method against a fake/mocked `db` following the existing "sniff by requested column keys" convention documented in `server/insights.md`
- [ ] Every method's SQL includes a `workspace_id` (or transitive-join equivalent) filter — self-audit each `.where()` clause before marking done

**Commit:** `feat(eval): add EvalRepository (workspace-scoped case/run/batch queries)`

---

### Step 4: Deterministic scoring — `eval/scoring.ts`

**Dependencies:** Step 2 (contract types for `Expectation`)
**Owned paths:** `server/src/modules/eval/scoring.ts` (new)

**What to do:**
1. Implement pure functions with zero I/O and zero LLM calls (AC-23) — this file must not import `container`, `db`, or any adapter:
   - `matchesExpectation(finding: { file: string; startLine: number; endLine: number }, expectation: Expectation): boolean` — true when `finding.file === expectation.file` AND the line ranges overlap (AC-19). Overlap test: `finding.startLine <= expectation.line_end && finding.endLine >= expectation.line_start`.
   - `scoreCase(expectations: Expectation[], keptFindings: FindingLike[]): CaseScoreResult` — for each `must_find` expectation, true if ANY kept finding matches it; for `must_not_flag`, a kept finding matching it counts as a violation. Returns `{ mustFindMatched: number; mustFindTotal: number; mustNotFlagViolations: number; findingsCount: number }`. An empty `expectations` array (AC-9's "clean diff" case) returns all-zero counts with no special branch — the general loop just doesn't iterate.
   - `aggregateRecall(caseResults: CaseScoreResult[]): number` — `sum(mustFindMatched) / sum(mustFindTotal)` across all scored cases in the batch (AC-20); guard division by zero (return `1` — vacuously satisfied — when `sum(mustFindTotal) === 0`, matching the edge-case table's "must_not_flag-only case… aggregated across all scored cases" note; document this choice inline since the spec does not pin the zero-denominator convention explicitly beyond "does not divide by zero at the batch level").
   - `aggregatePrecision(caseResults: CaseScoreResult[]): number` — `(sum(findingsCount) - sum(mustNotFlagViolations)) / sum(findingsCount)` across all scored cases (AC-21); guard `findingsCount total === 0` → return `1`.
   - `computeCitationAccuracy(keptCount: number, droppedCount: number): number` — `keptCount / (keptCount + droppedCount)` (AC-22); guard `(keptCount + droppedCount) === 0` → return `1`.
   - `casePassed(result: CaseScoreResult): boolean` — a case "passes" when every `must_find` expectation matched AND zero `must_not_flag` violations occurred; used to set `EvalBatchCaseOutcome.status`.
   - `computeAgentSnapshot(input: { systemPrompt: string; skills: string[]; model: string; provider: string }): { fingerprint: string; display: unknown }` — deterministic fingerprint (e.g. a stable JSON stringify + hash, or the display object itself used as the opaque identity — no cryptographic requirement, just stable equality) derived from system prompt + enabled skills IN ORDER + model + provider, never from the prompt alone (AC-17).
   - `computeFlakedStatus(lastThreeOutcomes: ('passed'|'failed'|'error')[]): boolean` — true when the outcome sequence contains both a pass and a (fail or error) within the last 3 full batches, i.e. it flipped (AC-27). Fewer than 2 data points → never flaked.
2. Severity/kind fields are read nowhere in this file's matching logic (AC-24) — do not add them to any comparison, only pass them through as display metadata in the calling layer.
3. Write `server/test/eval-scoring.test.ts` (hermetic, no mocks needed — pure functions) covering: exact-match, overlap-but-not-exact-match, non-overlap, empty-expectations "clean diff" case, `must_not_flag`-only case (zero `must_find` denominator), zero-findings batch, flaked-detection across pass/fail/error sequences, and an explicit assertion that no `LLMProvider` mock is ever constructed or invoked in this test file (satisfies the spec's Non-functional zero-LLM-calls verification requirement for the scoring step in isolation).

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `cd server && pnpm exec vitest run test/eval-scoring.test.ts` passes
- [ ] Test file contains an explicit assertion/comment confirming no LLM provider is touched during scoring

**Commit:** `feat(eval): add deterministic scoring (recall/precision/citation-accuracy, agent-snapshot, flaked)`

---

### Step 5: Service + run orchestrator — `eval/service.ts`, `eval/run-orchestrator.ts`

**Dependencies:** Step 3 (repository), Step 4 (scoring)
**Owned paths:** `server/src/modules/eval/service.ts` (new), `server/src/modules/eval/run-orchestrator.ts` (new), `server/src/modules/eval/helpers.ts` (new — DTO mapping)

**What to do:**
1. `EvalService` constructor takes `Container`, instantiates `this.repo = new EvalRepository(container.db)` (standard pattern — repos instantiated with `db`, not passed the whole container).
2. `listCases(workspaceId, agentId)`: calls `repo.listCases` + `repo.latestRunForCase` per case (or a single joined query if performance requires — repository's job to decide the actual SQL shape) to build `EvalCaseListItem[]`; also calls `repo.countSkillOwnedCases(workspaceId)` and returns it alongside (AC-2's visible-exclusion count surfaces here, not silently dropped).
3. `createCaseFromFinding(workspaceId, findingId)` (AC-1, AC-3, AC-4, AC-5, AC-6): resolve the finding via the existing findings/review lookup path (reuse `container`-exposed facades — do NOT import `reviews/service.ts` or `reviews/repository.ts` directly per R6; if no such facade exists yet on `Container`, add one following the `container.blast`/`container.contextDocs` lazy-getter-facade precedent — a thin `EvalFindingLookup` facade in `platform/container.ts` that wraps the minimal read (finding row + its review's PR + PR diff) the eval module needs, keeping `eval/` from reaching into `reviews/` internals). Derive: expectation `type` = `must_find` if `finding.accepted_at` else `must_not_flag` if `finding.dismissed_at` else throw `ValidationError('Finding must be accepted or dismissed first')`; `file`/`line_start`/`line_end` from the finding row; `severity`/`kind` copied as display metadata; diff fragment = `parseUnifiedDiff(prDiff.raw)`'s hunks filtered to `file === finding.file` only (AC-5 — not the whole PR diff), re-serialized to a minimal unified-diff string containing just that file's hunk(s); provenance = `{ source: 'finding', source_finding_id: findingId, source_pr_number: pr.number }`. No confirmation step — created immediately (AC-1).
4. `createCaseManual(workspaceId, agentId, input: EvalCaseCreateInput)` (AC-7, AC-8): run `parseUnifiedDiff(input.input_diff)` (reused from `server/src/adapters/git/diff-parser.ts`); if the result has zero files, throw `ValidationError('Diff fragment must reference at least one file')` — this is the save-time gate; the route returns it as an inline validation error, never persists (AC-8). On success, insert with `source: 'manual'`.
5. `deleteCase(workspaceId, caseId)`: requires the route to have already gated on an explicit confirmation (client-side modal, AC-10) — service just performs the delete; no extra confirmation logic server-side beyond existence/ownership check (`NotFoundError` if missing/cross-workspace).
6. `EvalRunOrchestrator` (separate file — keeps `service.ts` from growing past the ~300-line sub-plugin threshold noted in `server/insights.md`'s 2026-06-30 Pattern entry): `runBatch(workspaceId, agentId, caseIds?: string[])`:
   - Resolve the agent's current config (system prompt, enabled skills in order, model, provider) via the same facade used by `run-executor.ts` (do not duplicate that lookup logic — reuse or extract a small shared helper if one doesn't already exist as an importable unit; if `run-executor.ts`'s resolution logic is not cleanly extractable without touching `reviews/`, wrap it behind a `container`-level facade instead, per R6).
   - Compute `agentSnapshot` via `scoring.computeAgentSnapshot(...)`.
   - Determine batch `kind`: `caseIds` provided and a strict subset of the full case set → `calibration` (AC-14); omitted or equal to the full set → `full` (AC-11).
   - Insert the `eval_batches` row up front (status starts `null`/pending — the caller of this plan may choose to set it only after completion; either approach is acceptable as long as the final row has the sealed status before the API response returns, consistent with the existing `runCompleted` guard pattern in `run-executor.ts` — do not leave a batch row in a state a concurrent read could misinterpret as complete before it is).
   - Run cases with a `scheduleNext()` concurrency cap of 3 concurrent case-runs (mirror `reviews/routes.ts`'s exact pattern) — for each case, call `reviewPullRequest({ systemPrompt, model, diff: parseUnifiedDiff(case.input_diff), llm, skills, strategy: agent.strategy })` (AC-13 — the SAME call type, a synthetic diff fragment instead of a real PR).
   - On a per-case runtime failure (provider error/timeout): catch it, record that case's run row with an `error` status (distinct from a deterministic scored failure — AC-15), continue the remaining cases, and mark the eventual batch `status: 'degraded'` if this happens within a full-set batch. Aggregate metrics only from successfully-scored cases (AC-16).
   - For each successfully-scored case, call `scoring.scoreCase(case.expected_output, outcome.review.findings)` and `scoring.computeCitationAccuracy(outcome.review.findings.length, outcome.dropped.length)`; persist the `eval_runs` row (with `batch_id`, `recall`/`precision`/`citation_accuracy` not stored per-run per the existing `eval_runs` schema's own columns — confirm: `eval_runs` DOES have per-run `recall`/`precision`/`citation_accuracy` columns already, so store the per-case values there too, consistent with AC-35's "cost attributable per case, aggregable per batch").
   - After all cases complete, call `scoring.aggregateRecall`/`aggregatePrecision` over the batch's case results and `repo.updateBatchAggregate(...)` with the final `status` (`clean` unless any case errored, in which case `degraded`) — calibration batches get a comparable per-case status without the `clean`/`degraded` label (per spec Contracts note; store `status: null` for calibration or reuse the same enum informally — pick `null` per the Step 1 schema's nullable `status` column and document the choice in code comments).
7. `runSingleCase(workspaceId, agentId, caseId)`: thin wrapper calling `runBatch(workspaceId, agentId, [caseId])` (AC-12 — same mechanism, one-case subset, so it's automatically a calibration batch under the Step 5.6 kind-determination rule since a single case is a strict subset whenever the case set has more than one case; if the case set has exactly one case, treat it as `full` — the "strict subset" test naturally handles this).
8. `listBatchHistory`, `getBatchDetail`, `compareBatches(batchIdA, batchIdB)`, `getTrend(workspaceId, agentId)`, `getKpiDelta(workspaceId, agentId, latestBatchId)` (AC-31 — uses `repo.previousFullBatch`) — thin service methods composing repository reads into the Step 2 contract shapes.
9. Compute `last_run_status`/`last_run_summary`/flaked in `listCases` using `scoring.computeFlakedStatus(repo.lastThreeFullBatchOutcomesForCase(...))` — flaked takes precedence over a plain pass/fail label when it applies (AC-27).

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Hermetic test `server/test/eval-service.test.ts` using `MockLLMProvider` from `src/adapters/mocks.ts` (per the module's testing split convention) covering: case-from-finding derivation (accept vs. dismiss branch), manual-case diff validation (accept + reject paths), full-batch run with a mixed pass/fail case set, degraded-batch path (one case's mock LLM call throws), calibration-batch kind detection, KPI-delta skip-calibration logic
- [ ] No raw `Error` thrown anywhere in `service.ts`/`run-orchestrator.ts` — grep for `throw new Error` returns nothing in these two files

**Commit:** `feat(eval): add EvalService and batch run orchestrator`

---

### Step 6: Routes + module registration

**Dependencies:** Step 5 (service)
**Owned paths:** `server/src/modules/eval/routes.ts` (new), `server/src/modules/index.ts` (one import + one entry added)

**What to do:**
1. Create `eval/routes.ts` as a `FastifyPluginAsync`, `app.withTypeProvider<ZodTypeProvider>()`, instantiate `new EvalService(app.container)`.
2. Routes (all resolve `workspaceId` via `getContext(container, req)` first):
   - `GET /agents/:id/evals/cases` → `service.listCases` → `{ cases: EvalCaseListItem[], excluded_skill_owned_count: number }` (AC-2, AC-25).
   - `POST /agents/:id/evals/cases` (body: `EvalCaseCreateInput`) → `service.createCaseManual`.
   - `POST /findings/:id/evals/case` (body: none required — finding id from params) → `service.createCaseFromFinding` (AC-1). Route path chosen to mirror the existing `/findings/:id/action` pattern rather than nesting under `/agents/:id/...` since the entry point is a finding, and the owning agent is resolved server-side from the finding's review.
   - `DELETE /agents/:id/evals/cases/:caseId` → `service.deleteCase` (confirmation already happened client-side per AC-10; this is the actual delete call).
   - `POST /agents/:id/evals/run` (body: `EvalRunBatchRequest`, `config: { rateLimit: { max: 2, timeWindow: '1 minute' } }`) → if `case_ids` omitted, calls `runBatch(workspaceId, agentId)`; if present, calls `runBatch(workspaceId, agentId, case_ids)` — one route, both AC-11 and AC-14 (AC-18's rate limit applied here).
   - `GET /agents/:id/evals/batches` → `service.listBatchHistory` (AC-33).
   - `GET /agents/:id/evals/batches/:batchId` → `service.getBatchDetail` (AC-33's drill-down).
   - `GET /agents/:id/evals/trend` → `service.getTrend` (AC-28, AC-29, AC-30).
   - `GET /agents/:id/evals/compare?a=<batchId>&b=<batchId>` → `service.compareBatches` (AC-32).
3. Register: add `import evalModule from './eval/routes.js';` and `evalModule,` (renamed to avoid the reserved word `eval`) to the `modules` record in `server/src/modules/index.ts`.
4. Zod schemas for all params/body/querystring defined inline or in a local `schemas.ts` within the module, following the `IdParams` reuse pattern already established elsewhere (`../_shared/schemas.js` if that's where `IdParams` lives — confirm the exact import path used by `reviews/routes.ts` and mirror it).

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Route-level hermetic test `server/test/eval-routes.test.ts` using `buildApp()` + injected mocks (per the `blast-routes.test.ts`/`brief-routes.test.ts` precedent for route-level tests) covering: 200 on each route's happy path, 404 on cross-workspace case/batch access, 429 on rate-limit burst (fire >2 requests to `/agents/:id/evals/run` within the window and assert the 3rd is rejected)
- [ ] `cd server && pnpm dev` starts without error and `GET /agents/:id/evals/cases` is reachable for a seeded agent (manual smoke check against the user's own running server, per project convention — do not start a new server instance if one is already running)

**Commit:** `feat(eval): register eval module routes (case CRUD, run, history, trend, compare)`

---

### Step 7: Client hooks — `client/src/lib/hooks/eval.ts`

**Dependencies:** Step 6 (routes must exist for the hooks to target; Step 2 for types)
**Owned paths:** `client/src/lib/hooks/eval.ts` (new)

**What to do:**
1. Following the exact pattern in `client/src/lib/hooks/agents.ts` (React Query, `api.get`/`api.post`/`api.del` from `src/lib/api.ts`, query-key arrays, `invalidateQueries` on mutation success):
   - `useEvalCases(agentId: string | null | undefined)` → `useQuery({ queryKey: ["eval-cases", agentId], queryFn: () => api.get(`/agents/${agentId}/evals/cases`), enabled: !!agentId })`.
   - `useCreateEvalCase(agentId: string)` → `useMutation` posting `EvalCaseCreateInput`, invalidates `["eval-cases", agentId]`.
   - `useCreateEvalCaseFromFinding()` → `useMutation` posting to `/findings/${findingId}/evals/case`, invalidates `["eval-cases", agentId]` (agentId known client-side from the finding's owning agent context, or refetch-all if not directly available — accept an `agentId` param passed by the caller for the invalidation key).
   - `useDeleteEvalCase(agentId: string)` → `useMutation` calling `api.del`, invalidates `["eval-cases", agentId]`.
   - `useRunEvalBatch(agentId: string)` → `useMutation` posting `EvalRunBatchRequest` (empty body = full run; `{ case_ids: [id] }` = single-case run), invalidates `["eval-cases", agentId]`, `["eval-batches", agentId]`, `["eval-trend", agentId]` on success.
   - `useEvalBatchHistory(agentId: string | null | undefined)` → `useQuery(["eval-batches", agentId], ...)`.
   - `useEvalBatchDetail(agentId, batchId)` → `useQuery(["eval-batch-detail", agentId, batchId], ..., { enabled: !!batchId })`.
   - `useEvalTrend(agentId: string | null | undefined)` → `useQuery(["eval-trend", agentId], ...)`.
   - `useEvalCompare(agentId, batchIdA, batchIdB)` → `useQuery(["eval-compare", agentId, batchIdA, batchIdB], ..., { enabled: !!batchIdA && !!batchIdB })`.
2. All hooks import types from `@devdigest/shared` (the Step 2 contract additions) — never redefine local ad-hoc interfaces for these shapes.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] `cd client && pnpm test -- eval` (or the relevant hook test file if one is written) — hooks themselves are typically covered indirectly via the component tests in Step 8, per this codebase's existing convention of not unit-testing hooks in isolation when a container test already exercises them

**Commit:** `feat(client): add eval React Query hooks`

---

### Step 8: Client UI — EvalsTab (case list, Case Editor, batch history, trend, compare)

**Dependencies:** Step 7 (hooks), Step 2 (types)
**Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` (new directory — `EvalsTab.tsx`, `_components/CaseList/`, `_components/CaseRow/`, `_components/CaseEditor/`, `_components/BatchHistoryTable/`, `_components/TrendChart/`, `_components/BatchCompare/`, `styles.ts`), `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (add the tab switch branch), `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (add the `evals` entry to `TABS`), `client/messages/en/agents.json` (new `evals.*` translation keys)

**What to do:**
1. Add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" }` (or the closest available icon in `client/src/vendor/ui/icons.tsx` — check the registry first per the documented Quirk that only specific lucide icons are exported) to `TABS` in `constants.ts`.
2. In `AgentEditor.tsx`, add `tab === "evals" ? <EvalsTab agent={agent} /> : ...` following the existing ternary chain pattern exactly.
3. `EvalsTab.tsx` (container component): uses `useEvalCases(agent.id)`, `useEvalBatchHistory(agent.id)`, `useEvalTrend(agent.id)`. Renders:
   - Empty state (zero cases): two CTAs — a hint pointing to the FindingCard action, and a "+ New eval case" button opening `CaseEditor` (AC-11's edge case, spec §6 row 1).
   - `CaseList` (non-empty): each `CaseRow` shows status icon (never_run/passed/failed/error/flaked — 5 distinct visual states per AC-26/AC-27), name, subtitle (`last_run_summary`, or the `must_not_flag`-only wording "expected 0 flagged in guarded zone(s), got M" per the confirmed Q4 answer, or an explicit empty-set indicator when `expected_output` is `[]` per AC-9), expectation badge, per-row actions (run ▷ via `useRunEvalBatch` with `case_ids:[case.id]`, edit ✎ opening `CaseEditor` pre-filled, delete with a confirm modal per AC-10).
   - "Run all evals" button at the top of the case list → `useRunEvalBatch(agent.id).mutate({})`.
   - If `excluded_skill_owned_count > 0`, render a visible small note (AC-2) — never silently omit it.
   - `BatchHistoryTable`: timestamp, agent-snapshot identity (compact display), model, the three metrics, cost, status pill (clean/degraded/calibration) — clicking a row expands an inline per-case drill-down panel (AC-33); selecting exactly two rows (checkboxes or a "compare" affordance) renders `BatchCompare` inline under the table (AC-32).
   - `TrendChart`: one point per full batch in chronological order (calibration batches excluded, AC-28), tooltip shows agent-snapshot + cost (AC-29), degraded points visually distinct (a different marker shape/color, AC-30). Use a lightweight charting approach consistent with any existing chart in the codebase if one exists (check `client/src/vendor/ui/` first before adding a new charting dependency — if none exists, a minimal hand-rolled SVG sparkline/line-chart is acceptable given the "no external component library" constraint; do NOT add a new charting npm package without checking this constraint against `client/AGENTS.md` first).
4. `CaseEditor` (modal or side panel): diff-fragment textarea with a live preview (parse client-side is optional — the authoritative validation is server-side via `parseUnifiedDiff` at save time per AC-7/AC-8; the client may do a best-effort quick check for UX but MUST surface the server's validation error inline on save failure, never silently swallow it), expectation-type selector (`must_find`/`must_not_flag`), file + line-range inputs, notes field. Save calls `useCreateEvalCase` (or update, if editing) and shows the inline validation error from the API response on failure (AC-8) without closing the editor.
5. All user-facing strings via `useTranslations("agents")` with new keys under `evals.*` in `client/messages/en/agents.json` — no hardcoded English text anywhere in the new components (check `client/messages/en/agents.json` for any pre-existing `evals.*` keys first, per the documented pattern of some i18n namespaces being pre-populated for future lessons).
6. Keep each component under ~200 lines; split `CaseList`/`CaseRow` and `BatchHistoryTable`'s drill-down panel into their own files if a single file grows past that.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] `EvalsTab.test.tsx` (RTL + Vitest, fetch/hooks mocked per the `OnboardingTourView.test.tsx` precedent of mocking the feature's own hooks module rather than `fetch`) covers: empty state renders both CTAs, case list renders all 5 status states, "Run all evals" triggers the mutation, delete requires confirmation, trend chart excludes calibration batches, compare panel renders under two selected rows
- [ ] No hardcoded English string in any new `.tsx` file — grep for literal text nodes outside `t(...)` calls

**Commit:** `feat(client): add Evals tab (case list, editor, batch history, trend, compare)`

---

### Step 9: FindingCard — "→ eval case" action

**Dependencies:** Step 7 (hooks), Step 2 (types)
**Owned paths:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (edit — add one action button), `client/messages/en/prReview.json` (new translation key)

**What to do:**
1. In `FindingCard.tsx`'s existing `s.actions` button row (alongside the existing Accept/Dismiss buttons), add a third button visible only when the finding is accepted or dismissed (`accepted || dismissed`, using the existing `muted` boolean already computed in the component): a `Button kind="ghost" size="sm" icon="FlaskConical"` (or the closest available icon) calling `useCreateEvalCaseFromFinding().mutate({ findingId: f.id, agentId })` — `agentId` must be threaded down as a new optional prop (`agentId?: string | null`) since `FindingCard` does not currently receive it; trace the prop chain up from wherever `FindingCard` is rendered (`FindingsPanel`/`FindingsTab`) to find or add the agent id source (the review's `agent_id` field, per the `reviews` schema's existing `agentId` column) — thread it through as a new prop at each level, matching the existing `repoFullName`/`headSha` prop-threading pattern already used for the GitHub link feature.
2. On success, show a success confirmation (AC-1 — "no confirmation dialog and no intermediate save step, and SHALL show a success confirmation") — a transient toast/inline confirmation matching whatever lightweight success-feedback pattern already exists in this codebase for a fire-and-click action (check for an existing toast primitive in `client/src/vendor/ui/`; if none exists, a simple inline "Added to eval set ✓" text that fades after a few seconds, styled consistently with `s.acceptedTag`/`s.dismissedTag`'s existing tag styling, is acceptable — do not introduce a new toast library).
3. Button is disabled (or hidden) if the finding is neither accepted nor dismissed (AC-1 requires the source finding to already carry an accept/dismiss decision) and disabled while the mutation is pending.
4. Add the new translation key(s) to `client/messages/en/prReview.json` under a clear namespace, e.g. `finding.addToEvals` / `finding.addedToEvals`.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] Extend `FindingCard.test.tsx` (existing file) with: button hidden/disabled when finding is neither accepted nor dismissed, button visible and enabled once accepted, clicking calls the mutation with the correct `findingId`, success confirmation renders after the mutation resolves
- [ ] No hardcoded English string added

**Commit:** `feat(client): add "add to eval case" action on accepted/dismissed findings`

---

### Step 10: Seed data — 5 hand-authored demo eval cases

**Dependencies:** Step 1 (schema), Step 6 (module registered — not strictly required for the seed script itself to run, since seeding writes directly via Drizzle, but the eval module should exist so the seeded data is reachable through the API for manual verification)
**Owned paths:** `server/src/db/seed.ts` (edit — new section appended, following the file's existing per-feature section convention)

**What to do:**
1. Add a new seed section (mirroring the existing "Attach all 4 skills to the Test Quality Reviewer (idempotent)" section's style) that inserts exactly 5 `eval_cases` rows for the primary demo agent (whichever agent `seed.ts` already designates as the main demo reviewer — reuse that existing agent id/reference, do not create a new agent for this).
2. Design the 5 cases to exercise the scoring edge cases deliberately (per the confirmed Q2 answer — hand-authored for controlled coverage):
   - 2 cases with a `must_find` expectation each, using small realistic diff fragments (a few lines) that the seeded demo agent's configured model is expected to actually flag — keep diffs minimal to stay within the $0.10 batch cost bar (AC-34).
   - 1 case with a `must_not_flag` expectation only (exercises the zero-`must_find`-denominator path in `aggregateRecall`).
   - 1 case with a mix of one `must_find` and one `must_not_flag` expectation.
   - 1 "clean diff" case with `expected_output: []` (AC-9's empty-set indicator path).
3. Each case gets a fixed, deterministic UUID literal (hardcoded in the seed script, following the pattern of other stable seeded ids already used elsewhere in `seed.ts`) and the insert uses `.onConflictDoNothing()` targeting that literal id as the conflict key — re-running `pnpm db:seed` must not duplicate rows (AC-39).
4. Each case's `input_diff` must be a valid unified diff parseable by `parseUnifiedDiff` (reuse it in a quick manual check while authoring, or write a tiny throwaway script — not committed — to validate before pasting the final fixture into `seed.ts`).
5. Leave `eval_cases.input_files` empty/unset for all 5 (per the spec's explicit Non-goal: "Populating `eval_cases.input_files` with any required content — left to the implementation planner's discretion" — this plan's discretion is to not populate it, since `input_diff` alone is sufficient for `reviewPullRequest()`'s `diff` input).
6. This step only seeds the 5 demo-repo cases; the "at least 3 authored from real accept/dismiss decisions" half of AC-38's ≥8 bar is satisfied at demo/grading time by actually using the Step 9 FindingCard action against real seeded PRs/findings — not by additional seed-script fixtures. Note this explicitly in a code comment so a future reader doesn't expect the seed script alone to reach 8.

**Verify:**
- [ ] `cd server && pnpm db:seed` runs without error on a fresh DB
- [ ] Running `pnpm db:seed` a second time does not duplicate the 5 rows (`SELECT COUNT(*) FROM eval_cases WHERE owner_id = '<demo-agent-id>'` stays at 5 after 2 runs)
- [ ] Each seeded case's `input_diff` parses successfully via `parseUnifiedDiff` (spot-check manually or via a quick assertion in a throwaway script)
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "SELECT name, owner_id, expected_output FROM eval_cases WHERE owner_kind='agent'"` shows the 5 expected rows with sensible expectations

**Commit:** `feat(seed): add 5 demo eval cases for the primary agent (idempotent)`

---

### Step 11: `verify:l06` script + rate-limit test

**Dependencies:** Step 1–6 (all server-side eval code must exist; scoring tests from Step 4 and route tests from Step 6 already exist by this point)
**Owned paths:** `server/package.json` (add one script entry), `server/test/eval-rate-limit.test.ts` (new, if not already fully covered inline in Step 6's route test — see note below)

**What to do:**
1. Add to `server/package.json`'s `scripts`, mirroring `verify:l03`'s exact style:
   ```
   "verify:l06": "pnpm typecheck && pnpm exec vitest run test/eval-scoring.test.ts test/eval-service.test.ts test/eval-routes.test.ts"
   ```
   (Exact test file list matches whatever Steps 4/5/6 actually named their test files — reconcile at implementation time; the intent is "typecheck + every eval-pipeline deterministic-scoring/service/route test", per spec §7's "gating typecheck plus the eval-pipeline's deterministic-scoring test suite.")
2. If Step 6's `eval-routes.test.ts` did not already include a burst-of-rapid-calls throttling assertion (per that step's own Verify checklist item), add it now as a focused addition to that file (do not create a redundant new file if the coverage already exists — check first).
3. Confirm the script's test selection excludes any `.it.test.ts` (integration/Testcontainers) file, consistent with `verify:l03`'s hermetic-only convention — `verify:l06` must be runnable without Docker.

**Verify:**
- [ ] `cd server && pnpm verify:l06` exits 0
- [ ] The script does not invoke any `.it.test.ts` file
- [ ] Manually confirm (by reading the test file) that a burst of >2 rapid `POST /agents/:id/evals/run` calls in the test results in at least one rejected/throttled response

**Commit:** `chore(server): add verify:l06 script (typecheck + eval-pipeline test suite)`

---

## 6. Acceptance Criteria

- [ ] AC-1: Clicking the eval-case action on an accepted/dismissed finding creates a case immediately, no dialog, with a success confirmation (Steps 5, 9)
- [ ] AC-2: Skill-owned cases never silently mixed into agent totals; exclusion count always visible when non-empty (Steps 3, 5, 8)
- [ ] AC-3 / AC-4: Case from accepted finding → `must_find`; from dismissed → `must_not_flag`; severity/category carried as display metadata (Step 5)
- [ ] AC-5: Only the finding's own file's hunk(s) captured, not the whole PR diff (Step 5)
- [ ] AC-6: Provenance (finding id + PR number, or manual) recorded on every case (Steps 2, 5)
- [ ] AC-7 / AC-8: Manual/edited case diff fragment validated as a parseable unified diff referencing ≥1 file before save; inline error + no persistence on failure (Steps 5, 8)
- [ ] AC-9: Empty `expected_output` = valid "clean diff" case, no special-cased scoring branch, explicit empty-set UI indicator (Steps 4, 8)
- [ ] AC-10: Case deletion requires explicit confirmation (Step 8)
- [ ] AC-11 / AC-12: "Run all evals" covers the full case set (excluding skill-owned); per-row single-case run uses the same mechanism scoped to one case (Step 5, route in Step 6)
- [ ] AC-13: Every case run invokes the SAME `reviewPullRequest()` call type already used for real reviews — zero new LLM call sites (Step 5)
- [ ] AC-14: A strict-subset run is recorded as `calibration` (Step 5)
- [ ] AC-15 / AC-16: A per-case runtime failure doesn't abort the batch; failed case gets a distinct error state; batch marked `degraded`; aggregate metrics from successfully-scored cases only (Steps 4, 5)
- [ ] AC-17: Agent-snapshot identity derived from prompt + ordered skills + model + provider, never prompt alone (Step 4)
- [ ] AC-18: Eval-run route rate-limited (2/min) and concurrency-capped (3) (Steps 5, 6, 11)
- [ ] AC-19 – AC-24: Deterministic file+line-range-overlap matching; recall/precision/citation-accuracy formulas; zero LLM calls in scoring; severity/kind excluded from matching (Step 4)
- [ ] AC-25 / AC-26: Case list joined with most-recent outcome; never-run cases show a distinct state with no outcome text (Steps 5, 8)
- [ ] AC-27: Outcome flip across last 3 full batches → flaked (Steps 3, 4, 5)
- [ ] AC-28 – AC-30: Trend plots one point per full batch, chronological, calibration excluded; tooltip shows snapshot + cost; degraded points visually distinct (Steps 5, 8)
- [ ] AC-31: KPI delta compares against the immediately preceding full batch, skipping calibration batches (Step 3, 5)
- [ ] AC-32 / AC-33: Two-batch side-by-side compare with per-metric deltas and per-case outcomes; batch history shows all required fields with per-case drill-down (Steps 5, 6, 8)
- [ ] AC-34 / AC-35: Batch cost observable and ≤$0.10 for the reference case set on the cheap default model; cost attributable per case and aggregable per batch (Steps 5, 10)
- [ ] AC-36: Every eval-case/eval-run query workspace-scoped (directly or transitively) (Step 3)
- [ ] AC-37: Feature applies uniformly to every agent, each with isolated case set/batches/history (Steps 3, 5, 6)
- [ ] AC-38 / AC-39: ≥8 cases (5 seeded + ≥3 from real accept/dismiss) for the primary demo agent; seed is idempotent (Step 10)

## 7. Testing Plan

**Server:**

| Test | Type | Covers |
|---|---|---|
| `test/eval-scoring.test.ts` | hermetic | AC-9, AC-19–AC-24, AC-27 (pure functions, no mocks, explicit no-LLM-call assertion) |
| `test/eval-repository.test.ts` | hermetic | AC-2, AC-31, AC-36 (workspace-scoping, transitive joins) |
| `test/eval-service.test.ts` | hermetic (`MockLLMProvider`) | AC-1, AC-3–AC-8, AC-11–AC-17 |
| `test/eval-routes.test.ts` | hermetic (`buildApp()` + mocks) | AC-18 (rate-limit/concurrency burst test), AC-25, AC-32, AC-33, AC-36 (cross-workspace 404) |
| (optional) `test/eval-pipeline.it.test.ts` | integration (Testcontainers) | End-to-end: seed → run batch → verify persisted batch/run rows, real Postgres row-lock behavior on concurrent batch inserts if deemed necessary — not required by any AC but recommended if time permits; NOT part of `verify:l06`'s hermetic gate |

**Client:**

| Test | Type | Covers |
|---|---|---|
| `EvalsTab.test.tsx` | RTL + Vitest (hooks mocked) | AC-2, AC-9, AC-10, AC-25–AC-30, AC-32 |
| `CaseEditor.test.tsx` (if split out) | RTL + Vitest | AC-7, AC-8 |
| `FindingCard.test.tsx` (extended) | RTL + Vitest | AC-1 |

## 8. Out of Scope

- Harness-side eval tracks (`evals/` package skill-authoring eval, PreToolUse hook, mutation testing) — unrelated infrastructure per spec Non-goals.
- Export-to-CI wizard / CI-runner-side eval integration — unrelated, uses the pre-existing `eval-ci.ts` contracts which this plan does not touch.
- Stats and CI tabs on the Agent Editor — adjacent, unrelated tabs, not built here.
- An MCP `run_eval`-style tool in `mcp/` — explicitly deferred as future follow-up per spec Non-goals.
- A workspace-wide "Eval Dashboard" aggregating all agents — future work; this plan's per-agent contract shapes are designed to be reusable for it later but no dashboard route/page is built now.
- Any eval capability for `owner_kind='skill'` cases — routes/UI/scoring in this plan apply to `owner_kind='agent'` only; skill-owned cases are counted (AC-2) but never processed.
- A new read-only auditor/viewer permission tier — this feature introduces no new permission model, reuses the existing workspace-scoped agent-edit permission.
- Populating `eval_cases.input_files` — left unset per spec's explicit discretion grant (Step 10 note).
- Rewriting or removing the pre-existing `EvalCaseInput`/`EvalRunRecord`/`EvalRunResult`/`EvalTrendPoint`/`EvalDashboard` types in `eval-ci.ts` — left untouched, unused by this feature, reserved for potential future use.
