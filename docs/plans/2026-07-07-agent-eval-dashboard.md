# Development Plan: Agent Eval Dashboard

**Date:** 2026-07-07
**Requirements:** [docs/feature-requirements/2026-07-07-agent-eval-dashboard.md](../feature-requirements/2026-07-07-agent-eval-dashboard.md) (SPEC-2026-07-07-agent-eval-dashboard, 27 AC)
**Execution mode:** multi-agent (recommended — see §5 parallelization map and rationale below)
**Scope:** full-stack
**Affects modules:** `server/src/modules/eval/`, `server/src/modules/agents/`, `server/src/db/schema/{eval,agents}.ts`, `server/src/db/migrations/`, `server/src/platform/container.ts`, `server/src/vendor/shared/` (+ `client/src/vendor/shared/` mirror), `client/src/vendor/ui/nav.ts`, `client/src/app/evals/` (new), `client/src/lib/hooks/eval.ts`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`, `specs/eval-pipeline.md`

---

## 1. Context

An agent author who maintains more than one reviewer agent currently has no cross-agent view — each agent's eval metrics, trend, and run history live only behind that agent's own Evals tab. This feature adds a workspace-wide "Eval Dashboard" landing page (agent health cards + a recent-runs feed across all agents + a "Run all agents" fan-out trigger) and a per-agent detail page (KPI/trend/history reused from the existing Evals tab, plus an agent-switcher and a full compare-with-prompt-diff-and-promote modal). It builds entirely on the mature L06 `eval` module (case CRUD, batch orchestration, scoring) and the `agents` module's existing config-versioning mechanism — no new LLM call types, no new scoring logic, only aggregation, a new persisted field, and new UI.

Three `[NEEDS CLARIFICATION]` items from the spec are resolved with concrete, verified values (not assumptions):
- **`system_prompt_snapshot` persistence** → new nullable column on `eval_batches` via migration `0021` (additive; `agent_snapshot` untouched).
- **AC-15 "meaningful change" threshold** → confirmed by reading `KpiDeltaStrip.tsx`/`EvalMetrics.tsx`: no existing threshold convention exists in this codebase (both components render any non-null delta unconditionally, only suppressing an exact-zero value). Per the spec's own fallback default, the banner fires on **any non-zero delta on any of the 3 metrics**, worded around the single largest-magnitude metric.
- **Run-all concurrency/rate-limit** → confirmed at `server/src/modules/reviews/routes.ts:271` and `server/src/modules/eval/routes.ts:92-106`: **rate-limit 2/min, concurrency cap 3**, keyed per-workspace (matching `eval`'s own `eval-run:${workspaceId}` keying convention, not `review-all`'s default IP-keying — the eval module already established the stronger per-workspace pattern for paid-LLM fan-out).

The other 2 previously-open items are RESOLVED in the spec and encoded as-is: promote provenance = variant B (nullable `source`/`source_batch_id` on `agent_versions`, new migration `0022`); recent-runs row limit = 10 visible + vertical scroll, server cap 25.

## 2. Architecture Fit

**Server — two modules, one new cross-cutting getter:**
- Cross-agent aggregation reads (`GET /evals/overview`, `GET /evals/recent`) and the fan-out trigger (`POST /evals/run-all`) are new routes in the **existing `eval` module** (`server/src/modules/eval/routes.ts`), backed by new `EvalService`/`EvalRepository` methods. They reuse the existing `EvalRunOrchestrator.startBatch`/`executeBatch` per-agent — zero new LLM call types (AC-11).
- The promote mutation (`POST /agents/:id/evals/promote`) lives in the **`agents` module** (`server/src/modules/agents/routes.ts`), because it is fundamentally "update this agent's system prompt" and must reuse `AgentsRepository.update()`/the private `snapshotVersion()` method — both are internal to `agents` and R6 (module import isolation) forbids `eval` reaching into them directly. This exactly matches the spec's own sequence diagram (`Dashboard → AgentsModule: POST promote`).
- To let `agents` read a batch's `system_prompt_snapshot` without violating R6, a new **narrow cross-cutting getter `container.evalRepo`** is added to `platform/container.ts`, mirroring the existing `agentsRepo`/`reviewRepo` precedent (`container.ts:105-111`). It exposes exactly one method needed outside `eval`: `getBatchPromptSnapshot(workspaceId, batchId)`.
- `AgentsRepository.update()`'s patch type gains an optional `promote?: { sourceBatchId: string }` field, threaded into the existing private `snapshotVersion()` so the version-bump/snapshot invariant stays single-sourced (one write path stamps `source: 'eval_promote' | 'manual'` + `source_batch_id`).

**Client — one new route tree, zero hand-rolled chart/table UI:**
- New pages: `client/src/app/evals/page.tsx` (landing) and `client/src/app/evals/[agentId]/page.tsx` (detail), following the same `"use client"` + `useParams()` pattern used by every existing `agents/[id]` and `repos/[repoId]/...` page (per `client/insights.md` 2026-07-03 — do NOT use the async-Server-Component pattern from the one-off `context/page.tsx`).
- Reuses `EvalMetrics`, `TrendChart`, `BatchHistoryTable`, `KpiDeltaStrip`, `BatchCompare` from the existing `EvalsTab/_components/` tree unmodified where possible; `BatchHistoryTable`/`BatchCompare` gain new optional props for the modal-based compare flow this feature adds (existing inline-compare behavior in the per-agent Evals tab is unchanged).
- New small presentational components (agent card, recent-runs feed row, agent-switcher, compare modal, prompt-diff view) are added under `client/src/app/evals/_components/` — this is the feature's own page tree, not a promotion into `vendor/ui` (single-consumer code stays feature-scoped per `frontend-architecture`'s promotion rule).
- `Sparkline` (existing, barrel-exported, `charts/Sparkline.tsx`) is reused for the card's recall sparkline (AC-4) — distinct from `LineChart`, which `TrendChart` already wraps for the detail page's full trend.
- `Modal` (existing, barrel-exported, `kit/Modal.tsx`) hosts the new compare modal.
- The word-level prompt diff (AC-20) is a small dependency-free LCS-based pure function co-located with its consuming component — no new npm dependency, no vendor/ui promotion (single consumer).

## 3. Skills & Patterns Applied

**`backend-onion-architecture`:**
- New `eval` routes stay presentation-only (validate → call service → return); all business logic in `EvalService`; all DB access in `EvalRepository`.
- `POST /agents/:id/evals/promote` lives in `agents/routes.ts` → `AgentsService.promoteFromBatch()` → `AgentsRepository.update()` (existing method, widened patch type) — never a direct cross-module import of `eval`'s internals.
- New `container.evalRepo` getter follows the exact lazy-memoized pattern of `container.agentsRepo`/`container.reviewRepo` (R6-compliant cross-cutting facade, not a forbidden cross-module file import).
- Every new repository query is workspace-scoped (R1) — `eq(t.evalBatches.workspaceId, workspaceId)` / `eq(t.agents.workspaceId, workspaceId)` on every new method, including the cross-agent aggregation reads.
- All new expected failures throw `NotFoundError`/`ValidationError` (R3) — never raw `Error`.

**`fastify-best-practices` / `zod`:**
- New routes each get one Zod schema driving both validation and response typing (`fastify-type-provider-zod`), following the exact `IdParams`/`BatchIdParams` pattern already in `eval/routes.ts`.
- `POST /evals/run-all` and `POST /agents/:id/evals/promote` use `config: { rateLimit: {...} }` inline, matching `eval/routes.ts:96-105`'s existing per-workspace `keyGenerator` pattern (not the route-level default IP key).

**`drizzle-orm-patterns` / `postgresql-table-design`:**
- New nullable columns only (no altered columns) — `eval_batches.system_prompt_snapshot` (TEXT, nullable) and `agent_versions.source`/`agent_versions.source_batch_id` (TEXT enum-like + nullable UUID FK) each via their own numbered migration.
- `agent_versions.source_batch_id` references `eval_batches(id)` with `ON DELETE SET NULL` (a promoted-from batch may later be cleared via "Clear history" — AC-27's provenance marker must degrade gracefully, not cascade-delete a config-version row).

**`react-best-practices` / `next-best-practices` / `frontend-architecture`:**
- All data fetching via new TanStack Query hooks in `client/src/lib/hooks/eval.ts` (extending the existing file) — never `useEffect` for fetching.
- Derive `isBannerable`/`largestMagnitudeMetric` (AC-15) inline during render from the already-fetched KPI delta — no extra state.
- New page components stay under ~200 lines by composing the existing reused sub-components; page-level components are container components (fetch + compose), presentational logic stays in the sub-components.
- Promotion rule respected: the new prompt-diff algorithm and agent-switcher dropdown are feature-scoped (`client/src/app/evals/_components/`) since each currently has exactly one consumer.

**`security`:**
- AC-24/AC-25: every new read/write route re-verifies `workspaceId` server-side (never trust a client-supplied workspace) — confirmed via `getContext(container, req)` on every new handler, exactly like every existing route in this codebase.
- AC-25: promote additionally verifies the batch being promoted belongs to the **same agent** whose prompt is being changed (`batch.agentId === agentId`) before mutating — prevents a same-workspace IDOR where agent A's batch is used to overwrite agent B's prompt.
- System-prompt text and agent/case names shown in the compare modal are already-trusted, author-authored configuration text (per spec §10) — rendered through React's default JSX escaping, no `dangerouslySetInnerHTML` needed anywhere in the word-diff view.
- Rate limiting on `POST /evals/run-all` and `POST /agents/:id/evals/promote` prevents a click-burst from multiplying paid LLM batches (run-all) or mutation writes (promote) — mirrors the OWASP A06 rate-limiting guidance already applied project-wide.

## 4. Project Constraints

- Every new Drizzle query is workspace-scoped (`workspace_id` in the `WHERE` clause) — no exceptions, including read-only aggregation queries.
- Adapters only via `container.*` — the new `container.evalRepo` getter is added to the composition root (`platform/container.ts`) only; no module imports another module's concrete repository class directly.
- `AppError` subclasses (`NotFoundError`, `ValidationError`) for all expected failures — never raw `Error` or a bare `reply.status(4xx)` from inside a service.
- Secrets via `SecretsProvider` only — not applicable to new code in this feature (no new secrets), stated for completeness.
- DB schema is additive-only: two new nullable columns via two separate new numbered migrations (`0021`, `0022`) — never alter `eval_batches.agent_snapshot` or any existing `agent_versions` column.
- `server/src/vendor/shared/` changes (new/extended contracts) MUST be mirrored into `client/src/vendor/shared/` in the **same step** — this codebase's shared-types copy is NOT auto-synced (`client/insights.md` 2026-06-26, 2026-06-30; `server/insights.md` 2026-07-03 "separate physical copy" quirk).
- Static module registration — no new module is added in this feature (both `eval` and `agents` are already registered in `modules/index.ts`); no `modules/index.ts` edit needed.
- Module import isolation (R6) — the promote flow's cross-module read goes through the new `container.evalRepo` getter, never a direct `eval/repository.js` import inside `agents/`.
- **Nav/shortcut precedent-bug guard**: exactly one step (Step 8) has `client/src/vendor/ui/nav.ts` explicitly in its Owned paths — not deferred by cross-reference to any other step. The same step also adds the `g`-shortcut entry to the `SHORTCUTS` array in the same file (a second, independently-forgettable array in the same file — the precedent bug only documents `NAV` being missed, but `SHORTCUTS` is an equally real, separate omission risk since it's a parallel array, not derived from `NAV`).
- `pnpm verify:l06` must remain green after every server-side step — called out explicitly in the Testing Plan (§7).

---

## 5. Implementation Steps

**Execution mode: multi-agent.** Rationale: the server side (routes/service/repository/migrations in `eval` + `agents`) and the client side (new pages + hooks + compare modal) are naturally disjoint file sets with only two real cross-boundary dependencies (the shared-contract step must land before any client step that imports the new types; the two migrations must land before the service-layer steps that write to the new columns). This yields 4 real waves with a peak width of 5 fully-parallel steps — worth the coordination overhead of multi-agent over a purely sequential single pass.

**Parallelization map:**
- **Wave 1** (fully independent, no shared files): Step 1 (migration `0021`), Step 2 (migration `0022`), Step 3 (shared contracts), Step 9 (`specs/eval-pipeline.md` publication)
- **Wave 2** (needs Wave 1's migrations + contracts): Step 4 (`container.evalRepo` + `EvalRepository`/`EvalService` cross-agent reads), Step 5 (`AgentsRepository`/`AgentsService` promote + snapshot provenance), Step 8 (nav.ts + SHORTCUTS — independent of server work, only needs nothing but is client-only so grouped here to start as soon as Step 3's client-mirrored types are available for the badge/icon typing, though it does not actually import eval types — can start in Wave 1 in practice; kept in Wave 2 only for reviewer convenience, agents may start it in Wave 1 if free)
- **Wave 3** (needs Wave 2's routes + Step 3's client contracts): Step 6 (`eval` routes: overview/recent/run-all), Step 7 (`agents` route: promote), Step 10 (client hooks — `client/src/lib/hooks/eval.ts` extensions), Step 11 (landing page `client/src/app/evals/page.tsx` + `_components/AgentCard`, `RecentRunsFeed`)
- **Wave 4** (needs Wave 3's hooks + routes live): Step 12 (detail page `client/src/app/evals/[agentId]/page.tsx` + agent-switcher + KPI banner), Step 13 (compare modal + prompt word-diff + promote wiring), Step 14 (activate `EvalMetrics.tsx`'s inert dashboard link)

Steps within the same wave own fully disjoint paths (verified per-step below) and may run as separate implementer instances in parallel; steps in a later wave declare their Wave-N-or-earlier dependency explicitly.

---

### Step 1: Migration — `eval_batches.system_prompt_snapshot`

**Dependencies:** none
**Owned paths:** `server/src/db/schema/eval.ts`, `server/src/db/migrations/0021_eval_batch_prompt_snapshot.sql`, `server/src/db/migrations/meta/0021_snapshot.json`, `server/src/db/migrations/meta/_journal.json` (append-only edit — new entry only)
**What to do:**
1. Add `systemPromptSnapshot: text('system_prompt_snapshot')` (nullable, no default) to the `evalBatches` table definition in `server/src/db/schema/eval.ts`, directly below the existing `agentSnapshot: jsonb(...)` field. Do NOT touch `agentSnapshot` itself.
2. Run `pnpm db:generate` from `server/`. Per `server/insights.md`'s 2026-07-05 Quirk, drizzle-kit will name the file with a random adjective-noun pair — rename it to `0021_eval_batch_prompt_snapshot.sql` AND update the matching `"tag"` field in `meta/_journal.json` to the new filename stem (the rename without the journal edit silently orphans the file). Do NOT rename `meta/0021_snapshot.json` itself — it always stays in the plain `NNNN_snapshot.json` form regardless of the SQL/tag rename.
3. Before trusting the generated SQL, inspect it: it must be a single `ALTER TABLE eval_batches ADD COLUMN system_prompt_snapshot text;` with no other statements. If drizzle-kit's diff includes unrelated statements (stale snapshot chain drift is a documented recurring issue in this repo — `server/insights.md` 2026-07-03), stop and re-derive from `information_schema` ground truth per that insight entry's fix procedure instead of trusting the diff blindly.
4. Run `pnpm db:migrate` locally to confirm it applies cleanly against the running dev DB (per "Use manual server+client" convention — pause and confirm with the user before restarting `:3001` if it's already running).

**Verify:**
- [ ] `pnpm typecheck` (server) passes — the new column appears in `$inferSelect`/`$inferInsert` for `evalBatches`
- [ ] `pnpm db:migrate` applies without error
- [ ] `SELECT system_prompt_snapshot FROM eval_batches LIMIT 1;` returns `NULL` for pre-existing rows (backward-compat degrade path, AC-23)

**Commit:** `feat(db): add nullable system_prompt_snapshot column to eval_batches`

---

### Step 2: Migration — `agent_versions.source` / `source_batch_id`

**Dependencies:** none
**Owned paths:** `server/src/db/schema/agents.ts`, `server/src/db/migrations/0022_agent_version_provenance.sql`, `server/src/db/migrations/meta/0022_snapshot.json`, `server/src/db/migrations/meta/_journal.json` (append-only edit — new entry only, disjoint from Step 1's entry)
**What to do:**
1. Add two nullable columns to the `agentVersions` table in `server/src/db/schema/agents.ts`: `source: text('source', { enum: ['manual', 'eval_promote'] })` (nullable, no default — legacy rows read `null`, treated as `manual` per AC-27) and `sourceBatchId: uuid('source_batch_id').references(() => evalBatches.id, { onDelete: 'set null' })`. Import `evalBatches` from `./eval` at the top of the file (same-schema-package import, not a module boundary — `db/schema/*.ts` files already cross-reference each other, e.g. `agents.ts` imports `skills` from `./skills`).
2. Run `pnpm db:generate`, then rename the emitted SQL to `0022_agent_version_provenance.sql` and fix the `meta/_journal.json` tag, per the same procedure as Step 1.2.
3. Verify the generated SQL is exactly two `ALTER TABLE agent_versions ADD COLUMN ...` statements (`source text`, `source_batch_id uuid REFERENCES eval_batches(id) ON DELETE SET NULL`) plus the FK's supporting index (`CREATE INDEX ... ON agent_versions (source_batch_id)` — per `postgresql-table-design`, FK columns are never auto-indexed by Postgres and must be indexed explicitly; if drizzle-kit doesn't emit this automatically, add `sourceBatchIdx: index('agent_versions_source_batch_id_idx').on(t.sourceBatchId)` to the table's index block in step 1 and regenerate).
4. Run `pnpm db:migrate` locally (same pause-and-confirm convention as Step 1.4).

**Verify:**
- [ ] `pnpm typecheck` (server) passes
- [ ] `pnpm db:migrate` applies without error
- [ ] `SELECT source, source_batch_id FROM agent_versions LIMIT 1;` returns `NULL, NULL` for pre-existing rows

**Commit:** `feat(db): add nullable source/source_batch_id provenance columns to agent_versions`

---

### Step 3: Shared contracts — extend eval-batch + agent-version shapes, add dashboard contracts

**Dependencies:** none (contracts are additive TypeScript/Zod types, independent of the migrations actually being applied — but MUST be written to match Steps 1–2's exact column additions)
**Owned paths:** `server/src/vendor/shared/contracts/eval-batch.ts`, `server/src/vendor/shared/contracts/knowledge.ts`, `client/src/vendor/shared/contracts/eval-batch.ts`, `client/src/vendor/shared/contracts/knowledge.ts`
**What to do:**
1. In `server/src/vendor/shared/contracts/eval-batch.ts`:
   - Extend `EvalBatch` with `system_prompt_snapshot: z.string().nullable()` (additive field — per the spec's §9 "Batch — extended" contract; `null` means "predates this feature", never an empty string).
   - Extend `EvalBatchCompareResult` with `prompt_diff_available: z.boolean()` and `deltas.cost_usd: z.number().nullable()` (both additive, per spec §9 "Compare result — extended").
   - Add three new top-level contracts exactly per spec §9: `EvalAgentSummary` (`agent_id`, `agent_name`, `model`, `latest_batch: EvalBatch.nullable()`, `sparkline_points: z.array(z.object({ran_at: z.string(), recall: z.number()}))`, `case_count: z.number().int()`), `EvalRecentBatchRow` (`batch: EvalBatch`, `agent_id`, `agent_name`, `pass_count: z.number().int()`, `total_count: z.number().int()`), `EvalRunAllResult` (`started: z.array(z.object({agent_id: z.string(), batch_id: z.string()}))`).
   - Add `EvalPromoteRequest = z.object({ batch_id: z.string().uuid() })` per spec §9 "Promote request".
2. In `server/src/vendor/shared/contracts/knowledge.ts`: extend `AgentVersion`'s `config` sibling shape — add `source: z.enum(['manual', 'eval_promote']).nullish()` and `source_batch_id: z.string().nullish()` directly on `AgentVersion` (NOT inside `AgentVersionConfig`, which represents the frozen config snapshot itself — provenance is metadata ABOUT the version row, per spec §9's "Agent config version — extended" table, which lists `source`/`source_batch_id` as siblings of `agent_id`/`version`/`config`/`created_at`, not nested under `config`).
3. Mirror BOTH edited files byte-for-byte into `client/src/vendor/shared/contracts/eval-batch.ts` and `client/src/vendor/shared/contracts/knowledge.ts` — this is a manual copy, not a build step (confirmed no sync script exists, per `server/insights.md` 2026-07-03 and `client/insights.md` 2026-06-26/2026-06-30 Quirks). Diff the two directory trees after editing to confirm they match exactly for these two files.
4. Export all new contracts from both packages' `index.ts` barrels if the existing `eval-batch.ts`/`knowledge.ts` exports are already re-exported wildcard-style (`export * from './contracts/eval-batch.js'`) — confirm via existing barrel pattern before adding anything new.

**Verify:**
- [ ] `pnpm typecheck` passes in BOTH `server/` and `client/`
- [ ] `server/test/contracts.test.ts` (or equivalent) still passes — per `server/insights.md` 2026-06-30 Mistake, any new required field on an existing contract breaks fixture-based tests; these are all nullable/additive so no fixture should need updating, but verify
- [ ] Manual diff of `server/src/vendor/shared/contracts/{eval-batch,knowledge}.ts` vs `client/src/vendor/shared/contracts/{eval-batch,knowledge}.ts` shows identical content

**Commit:** `feat(shared): extend eval-batch and agent-version contracts for cross-agent dashboard`

---

### Step 4: `container.evalRepo` + `EvalRepository`/`EvalService` cross-agent read methods

**Dependencies:** Step 1 (migration), Step 3 (contracts)
**Owned paths:** `server/src/modules/eval/repository.ts`, `server/src/modules/eval/service.ts`, `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/run-orchestrator.ts` (snapshot-write only, see step 4.4), `server/src/platform/container.ts` (new getter only — additive, disjoint from Step 5's edits to the same file, see note below)
**What to do:**
1. In `EvalRepository`, add:
   - `listEvalConfiguredAgentSummaries(workspaceId)`: one query returning, per agent with ≥1 `eval_cases` row (`owner_kind='agent'`), the agent's id/name/model (join `agents`), its latest sealed full batch (subquery: `MAX(ran_at)` per `agent_id` where `kind='full' AND status IS NOT NULL`), and `case_count` — mirrors the existing `listTrendBatches`/`previousFullBatch` filter conventions (`kind='full'`, `isNotNull(status)`). Sparkline points are a second query: reuse `listTrendBatches`-style logic per agent, capped to a small N (e.g. last 8 points) — do not fetch full trend history for the card.
   - `listRecentBatchesAcrossAgents(workspaceId, limit)`: `eval_batches` joined to `agents` (for `agent_name`) and to a `pass_count`/`total_count` aggregate from `eval_runs` grouped by `batch_id`, `ORDER BY ran_at DESC, id DESC` (same tie-break convention as `listTrendBatches`), `LIMIT limit`. Called with the server cap (25) from the service layer, never unbounded (AC-9, §7's automated-test-required NFR).
   - `getBatchPromptSnapshot(workspaceId, batchId)`: returns `{ agentId, systemPromptSnapshot: string | null } | null`, workspace-scoped — this is the ONE method `container.evalRepo` exposes to `agents` module in Step 5.
2. In `EvalService`, add:
   - `getOverview(workspaceId): Promise<EvalAgentSummary[]>` — calls the new repo method, maps to the `EvalAgentSummary` DTO (§9), returns `[]` when no agent qualifies (AC-3, AC-5 — the client renders the empty state, this method just returns an empty array, no special-casing needed here).
   - `getRecentAcrossAgents(workspaceId): Promise<EvalRecentBatchRow[]>` — calls the new repo method with the fixed cap (25), maps to `EvalRecentBatchRow[]`.
   - `startRunAll(workspaceId): Promise<EvalRunAllResult>` — resolves the eval-configured agent list (reuse the same query as `getOverview`'s agent resolution, or factor a shared private helper), then for EACH agent calls `this.orchestrator.startBatch(workspaceId, agentId)` (reuses the exact per-agent `startBatch` — AC-11, zero new LLM call types) to get a `{batch, agent, skillBodies, targetCases}` tuple per agent, collecting `{agent_id, batch_id}` into `started`. Returns immediately (mirrors `startEvalRun`'s fast synchronous insert-only pattern) — does NOT execute the batches.
   - `executeRunAll(started, log)`: fans out `executeBatch(...)` per agent from the `startRunAll` result, bounded by the SAME `CONCURRENCY = 3` cap pattern already used inside `EvalRunOrchestrator.runWithConcurrencyCap` — reuse that private method by either exposing it or replicating the identical bounded-worker-pool shape at the service layer (prefer: add a `runOrchestrator`-level public `runManyBatchesWithCap(pairs, concurrency)` wrapper that iterates `{batch, agent, skillBodies, targetCases}` tuples calling `executeBatch` per tuple, capped at 3 concurrent agents — this satisfies AC-13 without duplicating the concurrency-cap algorithm).
3. When an agent has zero cases at the time `startRunAll` runs (edge case: last case deleted between page load and click), `startBatch` already throws `ValidationError('Agent has no eval cases to run')` for that one agent — catch and skip that agent inside `startRunAll`'s per-agent loop (log + continue), so one empty agent doesn't 500 the whole fan-out; that agent's `{agent_id, batch_id}` pair is simply omitted from `started` (consistent with `EvalRunAllResult.started`'s "empty entry" semantics in spec §9).
4. Extend `EvalRunOrchestrator.startBatch` to persist `systemPromptSnapshot: agent.systemPrompt` into the new column when inserting the batch row (Step 1's `insertBatch` call already accepts an object matching `EvalBatchInsert` — add the field there). This is the ONE place ALL batches (single-agent run, calibration run, and now run-all) get their prompt snapshot populated, satisfying AC-23 ("every batch created after this feature ships") without duplicating logic per call site.
5. In `platform/container.ts`, add a new lazy-memoized getter `evalRepo` following the exact `agentsRepo`/`reviewRepo` pattern (`private _evalRepo?: EvalRepository; get evalRepo(): EvalRepository { return (this._evalRepo ??= new EvalRepository(this.db)); }`), importing `EvalRepository` from `../modules/eval/repository.js`. This is an ADDITIVE insertion near the existing `agentsRepo`/`reviewRepo` getters (container.ts:77-111) — Step 5 also edits this file but only adds route wiring in `agents/routes.ts`/`agents/service.ts`, not this getter block, so the two steps' edits to `container.ts` are the only overlapping file; both edits are pure additions in the same small block and will not conflict if Step 4 lands first (Wave 2 ordering handles this — Step 5 depends on Step 4 completing for exactly this reason, see Step 5's Dependencies).

**Verify:**
- [ ] `pnpm typecheck` (server)
- [ ] Hermetic unit tests (see §7) for `getOverview`/`getRecentAcrossAgents`/`startRunAll` — assert workspace scoping (cross-workspace agent never appears), assert zero-case agents excluded from `getOverview`, assert `listRecentBatchesAcrossAgents` never returns more than the requested/default limit regardless of total batch count (§7 NFR)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes for all touched files

**Commit:** `feat(eval): add cross-agent overview/recent/run-all service methods + container.evalRepo`

---

### Step 5: `AgentsRepository`/`AgentsService` promote + version provenance

**Dependencies:** Step 2 (migration), Step 3 (contracts), **Step 4** (needs `container.evalRepo` to exist before wiring the promote flow's cross-module read)
**Owned paths:** `server/src/modules/agents/repository.ts`, `server/src/modules/agents/service.ts`, `server/src/modules/agents/helpers.ts`
**What to do:**
1. In `AgentsRepository`, widen `UpdateAgent`'s consumer — the `update()` method's `patch` parameter type — with an optional `promote?: { sourceBatchId: string }` field (do not change `UpdateAgent`/`UpdateAgentInput` in `service.ts`'s existing public signature; instead thread this as an additional optional parameter on `update()` itself: `update(workspaceId, id, patch, promote?: { sourceBatchId: string })`).
2. Update the private `snapshotVersion(row, version)` method's signature to `snapshotVersion(row, version, provenance?: { source: 'eval_promote'; sourceBatchId: string })`, and inside its `.values({...})` object add `source: provenance?.source ?? 'manual', sourceBatchId: provenance?.sourceBatchId ?? null` — every non-promote call path (agent creation, ordinary config edits) continues to pass no third argument, defaulting to `'manual'`, and `update()` forwards its own new `promote` parameter through to `snapshotVersion` when present.
3. Add `AgentsRepository.promoteSystemPrompt(workspaceId, agentId, newSystemPrompt, sourceBatchId)`: thin wrapper calling `this.update(workspaceId, agentId, { systemPrompt: newSystemPrompt }, { sourceBatchId })` — reuses the existing `update()` config-change/version-bump path unchanged (a system-prompt change already qualifies as a config change per the existing `isConfigChange` helper, so this naturally bumps `version` and snapshots).
4. In `AgentsService`, add `promoteFromBatch(workspaceId, agentId, batchId)`:
   - Look up the batch's prompt snapshot via `this.container.evalRepo.getBatchPromptSnapshot(workspaceId, batchId)`.
   - If the lookup returns `null` (batch not found / not in this workspace) → `throw new NotFoundError('Eval batch not found')`.
   - If `snapshot.agentId !== agentId` → `throw new ValidationError('Batch does not belong to this agent')` (AC-25 — ownership check before mutation).
   - If `snapshot.systemPromptSnapshot === null` → `throw new ValidationError('This batch has no stored prompt text and cannot be promoted')` (AC-22 — pre-feature batches degrade to rejected, never an empty-string promotion).
   - Otherwise call `this.repo.promoteSystemPrompt(workspaceId, agentId, snapshot.systemPromptSnapshot, batchId)`, return the updated `Agent` DTO via `toAgentDto`.
5. In `agents/helpers.ts`, update `toAgentVersionDto` to also map the two new columns: `source: row.source ?? 'manual', source_batch_id: row.sourceBatchId ?? null` onto the `AgentVersion` DTO (Step 3 already extended the `AgentVersion` Zod contract with these fields).

**Verify:**
- [ ] `pnpm typecheck` (server)
- [ ] Hermetic unit test: promoting a batch belonging to a DIFFERENT agent throws `ValidationError`, never mutates
- [ ] Hermetic unit test: promoting a batch with `system_prompt_snapshot: null` throws `ValidationError`, never mutates
- [ ] Hermetic unit test: a successful promote bumps `agents.version`, inserts a new `agent_versions` row with `source: 'eval_promote'` and the correct `source_batch_id`, and an ordinary `PUT /agents/:id` edit (no promote) still writes `source: null`/`'manual'` as before
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes for all touched files

**Commit:** `feat(agents): add promote-from-eval-batch with version provenance`

---

### Step 6: `eval` module routes — overview / recent / run-all

**Dependencies:** Step 4 (service methods), Step 3 (contracts)
**Owned paths:** `server/src/modules/eval/routes.ts`
**What to do:**
1. Add three new routes to the existing `evalRoutes` plugin (this file is currently 178 lines — well under the ~300-line sub-plugin threshold from `server/insights.md`'s 2026-06-30 Pattern, so no new peer plugin file is needed):
   - `GET /evals/overview` → `getContext` → `service.getOverview(workspaceId)`, response schema `z.array(EvalAgentSummary)`.
   - `GET /evals/recent` → `getContext` → `service.getRecentAcrossAgents(workspaceId)` (server-side cap of 25 applied inside the service, per Step 4.2 — no client-supplied limit query param needed per the spec's resolved NEEDS-CLARIFICATION), response schema `z.array(EvalRecentBatchRow)`.
   - `POST /evals/run-all` → 202-Accepted + detached fan-out, following the EXACT same shape as the existing `POST /agents/:id/evals/run` (routes.ts:92-127): `startRunAll` resolves+inserts synchronously, `executeRunAll` runs detached via `void ... .catch(...)` with a `req.log.child({...})` taken BEFORE responding (Fastify recycles `req.log` after response per the documented "recycled req.log" Mistake). Rate-limited `{ max: 2, timeWindow: '1 minute', keyGenerator: async (req) => \`eval-run-all:${(await getContext(container, req)).workspaceId}\` }` (AC-12 — per-workspace keying, matching the existing `eval-run:${workspaceId}` convention, NOT `review-all`'s IP-default). Response: `202` with `EvalRunAllResult` body (`{ started: [...] }`).
2. Add the three new routes' schemas to the file's existing top-of-file schema block, following the `CaseIdParams`/`BatchIdParams` naming convention already there (no request body/params needed for `overview`/`recent`; `run-all` needs no body either — the target set is derived server-side from "every eval-configured agent in this workspace").

**Verify:**
- [ ] `pnpm typecheck` (server)
- [ ] Hermetic route test: `GET /evals/overview` for a workspace with zero eval-configured agents returns `[]` (AC-5's server-side precondition)
- [ ] Hermetic route test: cross-workspace request to any of the 3 routes returns not-found/empty, never another workspace's data (AC-24, §7 NFR)
- [ ] Hermetic route test: a burst of `POST /evals/run-all` triggers is rate-limited (2nd rapid call rejected), not fully executed in parallel (§7 NFR, AC-12)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes for this file

**Commit:** `feat(eval): add GET /evals/overview, GET /evals/recent, POST /evals/run-all routes`

---

### Step 7: `agents` module route — promote

**Dependencies:** Step 5 (service method), Step 3 (contracts)
**Owned paths:** `server/src/modules/agents/routes.ts`
**What to do:**
1. Add `POST /agents/:id/evals/promote` to the existing `agentsRoutes` plugin: `{ schema: { params: IdParams, body: EvalPromoteRequest } }` → `getContext` → `service.promoteFromBatch(workspaceId, req.params.id, req.body.batch_id)` → return the updated `Agent` DTO with `200`. No custom rate limit needed beyond the app-level default (120/min) — promote is a single deliberate user action, not a fan-out; AC-12/AC-13's rate-limit/concurrency requirement is specific to `run-all`, not promote.
2. Import `EvalPromoteRequest` from `@devdigest/shared` (Step 3's new contract) alongside the file's existing shared-contract imports.

**Verify:**
- [ ] `pnpm typecheck` (server)
- [ ] Hermetic route test: promote on a batch from a different agent → `400`/`ValidationError` response shape (`ApiErrorBody`)
- [ ] Hermetic route test: promote with a valid same-agent batch that HAS a prompt snapshot → `200`, agent's `system_prompt` updated, `agents.version` incremented
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes for this file

**Commit:** `feat(agents): add POST /agents/:id/evals/promote route`

---

### Step 8: Nav entry + keyboard shortcut

**Dependencies:** none (pure client config, no dependency on server routes or contracts existing yet — the page it points to lands in Wave 3/4, but the nav entry itself can be added and merged independently; the route will 404 until Step 11 lands, which is acceptable mid-flight in a multi-agent build and is resolved before the feature is considered complete per AC-2)
**Owned paths:** `client/src/vendor/ui/nav.ts`
**What to do:**
1. Add one new `NavItemDef` to the existing `"SKILLS LAB"` section's `items` array (alongside `skills`/`agents`/`conventions`): `{ key: "evals", label: "Eval Dashboard", icon: "FlaskConical", href: "/evals", gKey: "e" }`. Confirm `"FlaskConical"` is a valid `IconName` (it is already used elsewhere in this feature's own reused components — `EvalsTab`'s empty state and `EvalMetrics`'s header both reference `Icon.FlaskConical`, confirming it exists in the icon registry).
2. Add the matching entry to the `SHORTCUTS` array in the SAME file: `{ keys: "g e", label: "Go to Eval Dashboard", group: "Navigation" }`, positioned after the existing `"g a"` (Agents) entry to match the `NAV` array's ordering.
3. This is the ONLY step in this plan that touches `nav.ts` — per this repo's documented precedent bug (`client/insights.md` 2026-07-03), no other step may defer this addition to "later" by cross-reference; both the `NAV` entry and the `SHORTCUTS` entry are added together, in this one step, in this one file.

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] `pnpm test` (client) — any existing snapshot/render test over `NAV`/`SHORTCUTS` (e.g. a sidebar or shortcuts-panel test) still passes with the new entry counted
- [ ] Manual grep confirms exactly one new entry in each of `NAV` and `SHORTCUTS`

**Commit:** `feat(nav): add Eval Dashboard sidebar entry and g-e shortcut`

---

### Step 9: Canonical spec publication

**Dependencies:** none (documentation-only; can run fully in parallel with all code steps)
**Owned paths:** `specs/eval-pipeline.md`
**What to do:**
1. In `specs/eval-pipeline.md` (SPEC-2026-07-05-eval-pipeline, the published canonical copy), find the Non-goal entry reading "a workspace-wide 'Eval Dashboard' sidebar page aggregating every agent's evals into one view — future work" and flip it: remove it from Non-goals, replacing it with a note that this is now covered by SPEC-2026-07-07-agent-eval-dashboard (with a relative link to `docs/feature-requirements/2026-07-07-agent-eval-dashboard.md`).
2. Append this feature's 27 acceptance criteria (AC-1 through AC-27, verbatim from the spec's §5) to the canonical document's own acceptance-criteria section, clearly delineated under a new subheading identifying them as sourced from SPEC-2026-07-07.
3. This step is purely additive documentation — it does not touch any other section of `specs/eval-pipeline.md`.

**Verify:**
- [ ] The flipped Non-goal no longer claims the dashboard is future work
- [ ] All 27 AC IDs (AC-1…AC-27) appear verbatim in the canonical doc
- [ ] No other content in `specs/eval-pipeline.md` was altered (diff review)

**Commit:** `docs(specs): publish Agent Eval Dashboard AC into canonical eval-pipeline spec`

---

### Step 10: Client hooks — cross-agent overview/recent/run-all/promote

**Dependencies:** Step 3 (contracts, client mirror), Step 6 (server routes live for real end-to-end use — though the hook code itself can be written against Step 3's types alone; Step 6 is needed for manual verification against a running server per this project's "use manual server+client" convention)
**Owned paths:** `client/src/lib/hooks/eval.ts` (new functions only, additive to the existing file — no edits to existing exported hooks), `client/src/lib/hooks/agents.ts` (new promote mutation hook only, additive)
**What to do:**
1. In `client/src/lib/hooks/eval.ts`, add:
   - `useEvalOverview()`: `useQuery({ queryKey: ["eval-overview"], queryFn: () => api.get<EvalAgentSummary[]>("/evals/overview") })`.
   - `useEvalRecentAcrossAgents()`: `useQuery({ queryKey: ["eval-recent"], queryFn: () => api.get<EvalRecentBatchRow[]>("/evals/recent") })`.
   - `useRunAllAgents()`: `useMutation({ mutationFn: () => api.post<EvalRunAllResult>("/evals/run-all"), onSuccess: (qc) => { invalidate "eval-overview" and "eval-recent" } })` — mirrors `useRunEvalBatch`'s existing invalidation pattern.
   - `useEvalCompareExtended` is NOT a new hook — the existing `useEvalCompare(agentId, batchIdA, batchIdB)` already returns `EvalBatchCompareResult`, which Step 3 already extended with `prompt_diff_available`/`deltas.cost_usd`; no hook change needed, only the consuming component (Step 13) reads the new fields.
2. In `client/src/lib/hooks/agents.ts`, add `usePromoteAgentPrompt(agentId)`: `useMutation({ mutationFn: (batchId: string) => api.post<Agent>(\`/agents/${agentId}/evals/promote\`, { batch_id: batchId }), onSuccess: (qc) => invalidate ["agent", agentId], ["agent-versions", agentId], ["eval-batches", agentId] })` — follow the exact existing mutation/invalidation shape already used by other agent-mutating hooks in this file (read the file first to match the established pattern before adding).

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] `pnpm test` (client) — hermetic test with `fetch` mocked for each new hook, following this codebase's existing hook-test convention (no running server needed)

**Commit:** `feat(hooks): add cross-agent eval overview/recent/run-all and promote hooks`

---

### Step 11: Landing page — `/evals`

**Dependencies:** Step 8 (nav entry exists so the page is reachable — AC-2), Step 10 (hooks)
**Owned paths:** `client/src/app/evals/page.tsx`, `client/src/app/evals/_components/EvalsLandingView/EvalsLandingView.tsx`, `client/src/app/evals/_components/AgentCard/AgentCard.tsx`, `client/src/app/evals/_components/RecentRunsFeed/RecentRunsFeed.tsx`, `client/messages/en/evals.json` (new i18n namespace)
**What to do:**
1. `page.tsx`: thin `"use client"` wrapper rendering `EvalsLandingView` — no data fetching at this layer (per `react-best-practices`, container components fetch, page files just compose).
2. `EvalsLandingView.tsx`: calls `useEvalOverview()` + `useEvalRecentAcrossAgents()` + `useRunAllAgents()`. Renders:
   - Loading skeleton state (reuse `Skeleton` from `@devdigest/ui`, matching `EvalsTab`'s existing loading pattern).
   - Empty state (AC-5) via `EmptyState` (`@devdigest/ui`, same primitive `EvalsTab` already uses) when `overview.length === 0` — no "Run all agents" button rendered in this state.
   - Non-empty state: a grid of `AgentCard` (one per `EvalAgentSummary`) + a "Run all agents" `Button` (disabled while `useRunAllAgents().isPending`) + `RecentRunsFeed` table.
3. `AgentCard.tsx`: renders agent name/model, latest batch's recall/precision/citation-accuracy (`pct()` helper, reused from `EvalsTab/helpers.ts` — import it directly, it's already a pure exported function, not a private module-internal), a `Sparkline` (from `@devdigest/ui`) fed by `sparkline_points.map(p => p.recall)`, last-run metadata (version label from `latest_batch.agent_snapshot`'s existing `snapshotLabel()`/`modelLabelFrom()` helpers — reuse, don't reimplement), and pass/total count. Degraded visual distinction (AC-6): apply the same `statusColor`/`Badge` convention `BatchHistoryTable` already uses for `status === 'degraded'` (`var(--crit)`) vs clean (`var(--ok)`) on the card's latest-batch indicator. A chevron/click affordance navigates to `/evals/${agent_id}` (AC-7) via `next/navigation`'s `useRouter().push()`.
4. `RecentRunsFeed.tsx`: a table matching `BatchHistoryTable`'s visual convention (same `s.table`/`s.th`/`s.td` style tokens — import the existing `styles.ts` from `EvalsTab` rather than duplicating style objects, OR create a small local `styles.ts` mirroring the same tokens if cross-importing a sibling feature's private `styles.ts` is undesirable; prefer re-exporting shared style tokens from a common location if one exists — check `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/styles.ts` first and reuse its `s.table`/`s.th`/`s.td` primitives directly if they're simple inline-style objects with no component-specific coupling). Adds an "Agent" column (the cross-agent differentiator vs. the per-agent `BatchHistoryTable`). Fixed to show 10 rows with `overflowY: "auto"` and a `maxHeight` (AC-9 — 10 visible + scroll, not pagination; the server already caps the fetched set to 25). Clicking a row navigates to `/evals/${row.agent_id}` (AC-10) — the specific batch is passed via a query param or router state so the detail page can pre-select/scroll to it (e.g. `router.push(\`/evals/${row.agent_id}?batch=${row.batch.id}\`)`), consumed by Step 12's detail page.
5. Add `client/messages/en/evals.json` with the new namespace's translation keys (empty-state title/body/cta, card labels, "Run all agents" button label, feed column headers, degraded label) — follow the exact key-naming convention already used in `client/messages/en/agents.json`'s `evals.*` keys (this new namespace is siblings to that one, not nested inside it, since this page lives outside the Agent Editor).

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] RTL test: empty state renders when `overview` is `[]`, no "Run all agents" button present (AC-5)
- [ ] RTL test: `AgentCard` renders degraded styling when `latest_batch.status === 'degraded'` (AC-6)
- [ ] RTL test: clicking a card / feed row calls `router.push` with the expected `/evals/:agentId` path (AC-7, AC-10)
- [ ] `pnpm test` (client) passes for all new files

**Commit:** `feat(evals): add cross-agent Eval Dashboard landing page`

---

### Step 12: Detail page — `/evals/[agentId]`

**Dependencies:** Step 10 (hooks), Step 11 (for the navigation target to exist meaningfully, though this page can be built independently and only needs Step 8's route to be linkable)
**Owned paths:** `client/src/app/evals/[agentId]/page.tsx`, `client/src/app/evals/_components/EvalDetailView/EvalDetailView.tsx`, `client/src/app/evals/_components/AgentSwitcher/AgentSwitcher.tsx`, `client/src/app/evals/_components/KpiBanner/KpiBanner.tsx`
**What to do:**
1. `page.tsx`: `"use client"`, reads `agentId` via `useParams()` (matches every other `agents/[id]`-style page's convention, per `client/insights.md` 2026-07-03 — do NOT use the one-off async-Server-Component pattern), reads an optional `?batch=` query param via `useSearchParams()` (guard with `?.get(...)` — jsdom/test environments return `null` for `useSearchParams()`, per `client/insights.md` 2026-06-30 Quirk), passes both to `EvalDetailView`.
2. `EvalDetailView.tsx`: fetches the target agent via the existing `useAgents()`/`useAgent(agentId)` hook (check `client/src/lib/hooks/agents.ts` for the exact existing single-agent hook name and reuse it — do not add a new one), plus `useEvalBatchHistory(agentId)`, `useEvalTrend(agentId)`, `useEvalKpiDelta(agentId)` (all THREE already exist, unmodified, from the per-agent Evals tab's hook set — this page is a NEW composition of EXISTING hooks, not new data-fetching logic). Also fetches `useEvalOverview()` to populate the `AgentSwitcher`'s selectable list (AC-16 — same eval-configured-agent criterion as AC-3, satisfied for free since `useEvalOverview()` already applies that filter server-side).
3. Composes: agent name/model/subtitle (run count + case-set size — derive from already-fetched `caseData`/`batches`, no new fetch), `EvalMetrics` (existing, reused as-is — same 3 KPI cards + sparkline + delta props it already accepts), `KpiBanner` (NEW — see below), `TrendChart` (existing, reused as-is), a per-agent-scoped `BatchHistoryTable` (existing, reused as-is — already agent-scoped by construction since it's called with this page's own `agentId`/`batches`).
4. `AgentSwitcher.tsx`: a `Dropdown`-based (existing `@devdigest/ui` primitive) selector populated from `useEvalOverview()`'s agent list; on selection, `router.push(\`/evals/${selectedAgentId}\`)` — swaps the whole page's content in place per Next.js client-side navigation (AC-16), no full page reload, no forced return to the landing page.
5. `KpiBanner.tsx` (AC-15): given the existing `EvalKpiDeltaResponse` (`{recall, precision, citation_accuracy}` or `null`), when non-null AND at least one of the three deltas is non-zero, render a warning/notice banner naming the single largest-magnitude metric (`Math.max(Math.abs(recall), Math.abs(precision), Math.abs(citation_accuracy))`) and its direction (`▲`/`▼`, reuse `deltaColor()`/`fmtDelta()` from `EvalsTab/helpers.ts`). When `delta === null` (no previous full batch — agent's first run) OR all three deltas are exactly `0`, render nothing (no banner, per AC-15's explicit "WHERE no previous full batch exists yet, SHALL NOT show this banner" and the edge-case table's "Two compared batches show no meaningful metric change → deltas shown as zero, not hidden" — note this applies to the COMPARE modal's raw delta display, not this banner, which legitimately suppresses on true zero since the banner's entire purpose is to flag a change worth noticing).
6. If the page loaded with a `?batch=` query param (from Step 11's recent-runs-feed row click), pass it down to `BatchHistoryTable` as a new optional `preselectBatchId` prop that pre-expands/scrolls to that row on mount (AC-10's "identifiable on arrival" — extend `BatchHistoryTable`'s existing `expandedId` initial state to seed from this prop instead of always starting `null`; this is the ONE new optional prop added to the existing component, backward-compatible since it's optional and unused by the per-agent Evals tab's existing call site).

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] RTL test: `KpiBanner` renders nothing when `delta === null` (first run) AND renders nothing when all deltas are exactly 0 (AC-15)
- [ ] RTL test: `KpiBanner` renders the largest-magnitude metric's direction/label when at least one delta is non-zero
- [ ] RTL test: `AgentSwitcher` selection triggers `router.push` to the new agent's detail path without a full reload (AC-16)
- [ ] RTL test: arriving with `?batch=X` pre-expands that batch's row in `BatchHistoryTable` (AC-10)
- [ ] `pnpm test` (client) passes for all new/touched files, INCLUDING the existing `BatchHistoryTable` test file (new optional prop must not break its existing test — it defaults to the prior always-collapsed behavior when the prop is omitted)

**Commit:** `feat(evals): add per-agent Eval Dashboard detail page with agent-switcher and KPI banner`

---

### Step 13: Compare modal — prompt word-diff + promote wiring

**Dependencies:** Step 10 (hooks incl. `usePromoteAgentPrompt`), Step 12 (detail page hosts this modal)
**Owned paths:** `client/src/app/evals/_components/CompareModal/CompareModal.tsx`, `client/src/app/evals/_components/CompareModal/diffWords.ts`, `client/src/app/evals/_components/CompareModal/diffWords.test.ts`, `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/BatchHistoryTable/BatchHistoryTable.tsx` (new optional prop only — additive, see note below)
**What to do:**
1. `diffWords.ts`: a pure, dependency-free function `diffWords(oldText: string, newText: string): DiffToken[]` where `DiffToken = { type: 'equal' | 'removed' | 'added'; text: string }`. Implement via a standard LCS (longest common subsequence) over word-tokenized input (split on `/(\s+)/` to preserve whitespace tokens), backtracking the LCS table into a token list. This is a well-understood, small (~40-60 line) algorithm — no external dependency needed, matching the "no external component library" convention. Add a co-located `diffWords.test.ts` (plain Vitest, no RTL needed — pure function) covering: identical strings → all `equal`; fully different strings → all `removed`+`added`; a single-word change in the middle → surrounding `equal` tokens preserved, only the changed word marked `removed`+`added`.
2. `CompareModal.tsx`: renders inside `@devdigest/ui`'s `Modal` primitive. Props: the two selected batch ids + `agentId`. Internally calls the EXISTING `useEvalCompare(agentId, batchIdA, batchIdB)` hook (already extended by Step 3's contract change to return `prompt_diff_available`/`deltas.cost_usd` — no hook change needed). Renders:
   - A metrics table reusing `BatchCompare`'s existing row-rendering pattern but extended with a 4th "Cost" row using the new `deltas.cost_usd` field (AC-19) — either extend `BatchCompare` itself with an optional `showCost` prop (preferred — avoids duplicating the table markup) or compose a local variant; prefer extending `BatchCompare` with an additive optional prop, since it's a one-line addition to an already-simple component (`rows.push({label: t("evals.compare.cost"), a: result.a.cost_usd, b: result.b.cost_usd, delta: result.deltas.cost_usd})` when the prop is set and `deltas.cost_usd != null`).
   - A prompt-diff section: when `result.prompt_diff_available === false`, render an explanatory note ("one or both batches predate full-prompt tracking") and disable/hide the toggle. When `true`, render `diffWords(result.a.system_prompt_snapshot!, result.b.system_prompt_snapshot!)`'s output as inline `<span>` tokens — `removed` tokens with strikethrough + a subtle red background, `added` tokens with a subtle green background, `equal` tokens plain — plus a toggle control to instead show batch A's or batch B's full prompt text verbatim (AC-20).
   - A "Promote v_new" button (labeled with the newer batch's ordinal — derive display ordinal from the batch's position in the agent's already-fetched batch history, NOT `agents.version`, per the spec's explicit note that these are two distinct counters) calling `usePromoteAgentPrompt(agentId).mutate(newerBatchId)`. Disabled when `result.prompt_diff_available === false` for the NEWER batch specifically (AC-22 — a batch with no snapshot can't be promoted; note the metrics-only comparison itself is still allowed even if one side lacks a prompt snapshot, only the Promote action is gated). On success, show a confirmation (toast or inline success state — reuse whatever existing confirmation UI pattern the codebase already has for mutation success, e.g. check `ConfirmModal`/toast usage elsewhere before inventing a new pattern) and close the modal (AC-21).
3. Wire `CompareModal` into `BatchHistoryTable`: add a new optional prop `useModalCompare?: boolean` (default `false`/unset) — when true, instead of rendering `BatchCompare` inline (the per-agent Evals tab's existing behavior, unchanged when this prop is omitted), render a "Compare" button that opens `CompareModal` in a portal/modal overlay. This keeps the EXISTING per-agent Evals tab's inline-compare UX completely unchanged (prop defaults to off) while letting the new detail page (Step 12) opt into the modal-based flow the spec's AC-18/AC-19 describe ("enable a 'Compare' action" — a button, not an always-visible inline table). Step 12's `EvalDetailView` passes `useModalCompare={true}` when composing `BatchHistoryTable`.

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] `diffWords.test.ts` — all 3 cases above pass, plus a case confirming whitespace-only differences don't misalign surrounding equal tokens
- [ ] RTL test: `CompareModal` disables/hides the prompt-diff toggle and shows the explanatory note when `prompt_diff_available: false`
- [ ] RTL test: Promote button disabled when the newer batch has no prompt snapshot (AC-22)
- [ ] RTL test: successful promote shows a confirmation and closes the modal (AC-21)
- [ ] RTL test: existing `BatchHistoryTable.tsx` test suite still passes unmodified (the new prop defaults to prior inline-`BatchCompare` behavior)
- [ ] `pnpm test` (client) passes for all new/touched files

**Commit:** `feat(evals): add compare modal with word-level prompt diff and promote action`

---

### Step 14: Activate the inert "View full dashboard →" link

**Dependencies:** Step 11 (landing page must exist at `/evals` for the link to resolve to something real)
**Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/EvalMetrics/EvalMetrics.tsx`
**What to do:**
1. Replace the inert `<span style={s.dashboardLinkDisabled} aria-disabled="true" title={t("evals.metrics.dashboardSoon")}>` block with a real navigable link/button using `next/navigation`'s `useRouter().push("/evals")` (or, preferably, the agent's own detail page `/evals/${agentId}` — since the user is already inside that specific agent's Evals tab, routing straight to that agent's dashboard detail page is more useful than the workspace landing page; use `/evals/${agent.id}`, which `EvalMetrics` can access since `EvalsTab` already receives the full `agent: Agent` prop and could thread `agentId` down, OR read it from a new prop added to `EvalMetricsProps` — add `agentId: string` as a new required prop, and update `EvalsTab.tsx`'s existing `<EvalMetrics .../>` call site to pass `agentId={agent.id}`).
2. Remove the now-unused `s.dashboardLinkDisabled` style token if nothing else references it (check `styles.ts` for other usages first).
3. Update the `evals.metrics.dashboardSoon` translation key's usage — either repurpose it as an `aria-label`/tooltip for the now-active link, or remove it if no longer needed (check for other references before deleting the key from `messages/en/agents.json`).

**Verify:**
- [ ] `pnpm typecheck` (client)
- [ ] RTL test: clicking the (now active) "View full dashboard →" link/button navigates to `/evals/${agentId}`
- [ ] Existing `EvalMetrics`/`EvalsTab` test files updated for the new required `agentId` prop and still pass
- [ ] `pnpm test` (client) passes for all touched files

**Commit:** `feat(evals): activate inert dashboard link in per-agent EvalMetrics`

---

## 6. Acceptance Criteria

- [ ] AC-1: Step 8 — one new `NAV` entry in `"SKILLS LAB"` with its own `gKey`, `SHORTCUTS` entry added in the same step
- [ ] AC-2: Step 8 (nav entry) + Step 11 (landing page exists) together — sidebar entry reachable from any page once both land
- [ ] AC-3: Step 4 (`listEvalConfiguredAgentSummaries` filters to ≥1 eval case) + Step 11 (renders only what the API returns)
- [ ] AC-4: Step 4 (per-agent latest batch + sparkline points + case_count in `EvalAgentSummary`) + Step 11 (`AgentCard` renders all of it)
- [ ] AC-5: Step 11 (`EvalsLandingView`'s empty-state branch, no "Run all agents" button rendered)
- [ ] AC-6: Step 11 (`AgentCard`'s degraded visual distinction, reusing `BatchHistoryTable`'s status-color convention)
- [ ] AC-7: Step 11 (`AgentCard`'s chevron/click → `router.push`)
- [ ] AC-8: Step 4 (`listRecentBatchesAcrossAgents`) + Step 11 (`RecentRunsFeed` renders agent name/timestamp/version/metrics/pass-count)
- [ ] AC-9: Step 4 (server-side cap of 25) + Step 11 (client renders 10 visible rows + scroll, never unbounded)
- [ ] AC-10: Step 11 (row click → `router.push` with `?batch=`) + Step 12 (`preselectBatchId` pre-expands on arrival)
- [ ] AC-11: Step 4 (`startRunAll`/`executeRunAll` reuse `EvalRunOrchestrator.startBatch`/`executeBatch` — zero new LLM call types)
- [ ] AC-12: Step 6 (`POST /evals/run-all` rate-limited 2/min per-workspace)
- [ ] AC-13: Step 4 (`runManyBatchesWithCap` bounded at `CONCURRENCY = 3`)
- [ ] AC-14: Step 12 (`EvalDetailView` composes name/model/subtitle + `EvalMetrics` + `TrendChart` + agent-scoped `BatchHistoryTable`)
- [ ] AC-15: Step 12 (`KpiBanner` — largest-magnitude metric wording, suppressed on null/zero delta)
- [ ] AC-16: Step 12 (`AgentSwitcher` swaps content via `router.push`, list scoped to `useEvalOverview()`'s already-filtered agents)
- [ ] AC-17: Step 12 (reuses existing `useRunEvalBatch`/`EvalsTab`-established "Run eval" mechanism — no new call type; confirmed via composing existing hooks only)
- [ ] AC-18: Step 13 (`CompareModal`'s trigger — `BatchHistoryTable`'s existing exactly-2-selected gating, unchanged, now opens a modal instead of inline panel when `useModalCompare` is set)
- [ ] AC-19: Step 13 (`CompareModal`'s metrics table incl. cost row via extended `BatchCompare`)
- [ ] AC-20: Step 13 (`diffWords.ts` + toggle between old/new full text)
- [ ] AC-21: Step 13 (Promote button → `usePromoteAgentPrompt` → confirmation)
- [ ] AC-22: Step 5 (service-layer rejection when `system_prompt_snapshot` is null) + Step 13 (button disabled client-side for the same condition)
- [ ] AC-23: Step 1 (new nullable column) + Step 4.4 (populated on every batch insert going forward, old rows stay null)
- [ ] AC-24: Step 4 (workspace-scoped `listEvalConfiguredAgentSummaries`/`listRecentBatchesAcrossAgents`, `owner_kind='agent'` filter inherited from existing `listCases`-style scoping)
- [ ] AC-25: Step 5 (`promoteFromBatch`'s explicit `snapshot.agentId !== agentId` check before mutation)
- [ ] AC-26: Step 5 (`promoteSystemPrompt` reuses `AgentsRepository.update()`'s existing version-bump/snapshot path unchanged)
- [ ] AC-27: Step 2 (new columns) + Step 5 (`snapshotVersion` provenance stamping) + Step 5.5 (`toAgentVersionDto` surfaces it)

## 7. Testing Plan

**Server:** hermetic (`.test.ts` with `src/adapters/mocks.ts`) for all new service/repository logic per this plan's Verify checklists — no new integration (`.it.test.ts`) suite is strictly required since every new route composes already-integration-tested primitives (`EvalRunOrchestrator`, `AgentsRepository.update()`), but if the multi-agent implementers judge a real-DB confirmation valuable for the two new migrations' actual column behavior, one small `.it.test.ts` asserting `system_prompt_snapshot`/`source`/`source_batch_id` round-trip through a real Postgres instance is a reasonable addition (optional, not blocking).

**Client:** Vitest + RTL, `fetch` mocked via the existing `api` module mock convention — no running server needed for any test in this plan.

| Test | Type | Covers |
|---|---|---|
| `EvalRepository.listEvalConfiguredAgentSummaries` workspace/zero-case filtering | hermetic | AC-3, AC-24 |
| `EvalRepository.listRecentBatchesAcrossAgents` limit enforcement | hermetic | AC-9, §7 NFR |
| `EvalService.startRunAll`/`executeRunAll` concurrency cap + zero-case-agent skip | hermetic | AC-11, AC-13 |
| `POST /evals/run-all` rate-limit burst rejection | hermetic route test | AC-12, §7 NFR |
| Cross-workspace request to `/evals/overview`, `/evals/recent`, `/agents/:id/evals/promote` | hermetic route test | AC-24, AC-25, §7 NFR |
| `AgentsService.promoteFromBatch` cross-agent rejection | hermetic | AC-25 |
| `AgentsService.promoteFromBatch` null-snapshot rejection | hermetic | AC-22, AC-23 |
| `AgentsRepository.update()`+`snapshotVersion` provenance stamping (promote vs manual) | hermetic | AC-26, AC-27 |
| `diffWords.ts` pure-function cases | hermetic (Vitest, no RTL) | AC-20 |
| `EvalsLandingView` empty state / degraded card / navigation | RTL | AC-5, AC-6, AC-7, AC-10 |
| `KpiBanner` null-delta and zero-delta suppression, largest-magnitude wording | RTL | AC-15 |
| `AgentSwitcher` navigation | RTL | AC-16 |
| `CompareModal` prompt-diff-unavailable degrade + promote-disabled-when-no-snapshot | RTL | AC-20, AC-22 |
| `BatchHistoryTable` existing suite unaffected by new optional props | RTL (regression) | no AC — architectural safety net for Steps 12–13's additive props |

**`pnpm verify:l06` must remain green** after every server-side step (Steps 1, 2, 4, 5, 6, 7) — run it as part of each of those steps' local verification before committing, in addition to the scoped hermetic test runs listed in each step's own Verify checklist.

## 8. Out of Scope

- Any change to per-agent Evals tab case CRUD, Case Editor, or single-case calibration runs (spec Non-goal 1) — this plan reuses those read-side components unmodified except the two additive optional props documented in Steps 12–13.
- A workspace-wide dashboard for skill evals (`owner_kind='skill'`) — this plan's aggregation is `owner_kind='agent'` only throughout (spec Non-goal 2).
- Any new permission tier or read-only auditor role (spec Non-goal 3).
- The mockup's "GLOBAL" sidebar section — only the single "Eval Dashboard" item under "SKILLS LAB" is in scope (spec Non-goal 4).
- Live/streaming updates beyond the existing per-batch polling convention (`useEvalBatchDetail`'s self-poll, reused unchanged) — the landing page's cards and recent-runs feed refresh on navigation/re-fetch only (spec Non-goal 5).
- Any change to how a batch is scored or to the recall/precision/citation-accuracy formulas (spec Non-goal 6).
- Exposing any new dashboard capability as an MCP tool (spec Non-goal 7).
- Historical backfill of full system-prompt text for pre-feature batches — they permanently read `system_prompt_snapshot: null` and degrade per AC-22/AC-23 (spec Non-goal 8).
- A client-supplied `limit` query parameter on `GET /evals/recent` — the server-side cap (25) is fixed, not configurable, per the spec's resolved clarification.
