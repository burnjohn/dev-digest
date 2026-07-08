# Development Plan: Skill Eval Pipeline

**Date:** 2026-07-06
**Requirements:** [docs/feature-requirements/2026-07-06-skill-eval-pipeline.md](../feature-requirements/2026-07-06-skill-eval-pipeline.md) (Status: draft; SPEC-2026-07-06-skill-eval-pipeline, 39 EARS AC)
**Execution mode:** multi-agent
**Scope:** full-stack
**Affects modules:** `server/src/modules/skills/` (extended — case CRUD already exists, this plan adds run/scoring/history), `server/src/db/schema/eval.ts` (extended via new migration), `server/src/db/migrations/` (new numbered migration), `server/src/vendor/shared/contracts/` (new additive file), `client/src/vendor/shared/contracts/` (mirrored copy), `client/src/app/skills/_components/SkillDetail/` (`EvalsTab.tsx` full rewrite + new `_components/`), `client/src/lib/hooks/skills.ts` (extended), `server/src/db/seed.ts` (extended)

---

## 1. Context

A skill has no model, provider, or prompt of its own — it is inert until attached to a host agent's review pipeline. Today a skill author can create eval cases for a skill (`GET/POST/DELETE /skills/:id/evals`, `owner_kind='skill'` rows in `eval_cases`), but there is no way to run them: the client's `Run all evals` button is hardcoded `disabled`, and no orchestrator, scoring, or batch-history capability exists for skills. This feature closes that gap by letting a skill author pick a **host agent** (defaulting to the workspace's primary demo reviewer), run the skill's case set through that host agent's live `reviewPullRequest()` pipeline with the skill added to whatever skills the host agent already has linked (**marginal-contribution**, never isolation), and score the result with the same two-tier methodology this repo's own eval harness (`evals/` package) already uses: a cheap deterministic **grounding** substring-presence gate that runs first, followed by a real-LLM **practices judge** (binary pass/fail per practice with required verbatim evidence) only when grounding passed.

This is a sibling capability to the already-implemented agent-eval pipeline (`server/src/modules/eval/`, L06 — recall/precision/citation-accuracy against `must_find`/`must_not_flag` expectations), not a replacement or an extension of it. The two pipelines share table infrastructure patterns (`eval_cases`, a batch table, a 202+poll run flow, workspace-scoped repositories) but use **entirely different scoring methodologies** and **entirely different route surfaces** (`/agents/:id/evals/*` vs `/skills/:id/evals/*`). This plan reuses every applicable pattern from the live agent-eval code (not the older, now-superseded planning doc for it) but writes new scoring, a new orchestrator, and a new batch table for skills.

## 2. Architecture Fit

New capability added to the existing `server/src/modules/skills/` module (chosen over a new `skill-eval/` module — see Constraints for the file-size mitigation) plus new pure scoring logic in a dedicated file.

- **Presentation** (`skills/eval-routes.ts`, a new sub-plugin — see Constraints for why this is split from `skills/routes.ts`): run routes (full-set + single-case, one handler, mirroring `eval/routes.ts`'s `POST /agents/:id/evals/run` 202 pattern), batch history/detail routes, host-agent-selection support (`GET /agents` already exists and is reused as-is by the client — no new "list candidate host agents" route is needed). Case CRUD (`GET/POST/DELETE /skills/:id/evals`) already lives in `skills/routes.ts` and stays there, extended in place for `PATCH` (edit) and the practices/grounding/threshold shape.
- **Application** (`skills/eval-service.ts`, a new sub-service; `skills/eval-orchestrator.ts`, new — mirrors `eval/run-orchestrator.ts`'s `startBatch()`/`executeBatch()` split): resolves the host agent's current config (system prompt, linked skills, model, provider) via `container.agentsRepo`, appends the skill-under-test's body to the host agent's already-linked skill bodies (marginal contribution — AC-13), invokes `reviewPullRequest()` per case exactly as the agent-eval orchestrator does, runs the two-tier scoring (`patternMatch` then, conditionally, the practices judge), persists results, seals the batch aggregate.
- **Application — scoring** (`skills/eval-scoring.ts`, new, pure functions, zero I/O): `patternMatch()` (deterministic substring gate, ported from `evals/src/scoring/pattern-match.ts`'s exact algorithm — case-insensitive `includes()` fraction) and a server-side `judgePractices()` that calls `container.llm(judgeProvider)` with a structured-output schema mirroring `evals/src/scoring/llm-judge.ts`'s `Verdict` shape, using `reviewer-core`'s exported `toJsonSchema`/`parseWithRepair` (never re-implementing JSON extraction).
- **Infrastructure** (`skills/eval-repository.ts`, new — kept separate from the existing `SkillsRepository` to avoid growing it past a clean single responsibility; instantiated the same way, with `container.db`): Drizzle queries against `eval_cases` (existing, `owner_kind='skill'`), the new `skill_eval_batches` table, and `eval_runs` (existing, extended with a new nullable `skill_batch_id` column). Every query workspace-scoped directly (`skill_eval_batches.workspace_id`) or transitively through `eval_cases.workspace_id`.
- **New DB migration** (`00XX_skill_eval_batches.sql` — exact number assigned at generation time, see Step 1): `CREATE TABLE skill_eval_batches` (own `workspace_id`, `skill_id` → skills, `host_agent_id` → agents, aggregate metrics, status, snapshot identity) + `ALTER TABLE eval_runs ADD COLUMN skill_batch_id` (nullable FK → `skill_eval_batches`, `ON DELETE SET NULL`) — additive only, mirrors exactly how `eval_batches`/`eval_runs.batch_id` were added for the agent-eval pipeline. `eval_cases`'s existing columns (`input_diff`, `expected_output`, `input_meta`, `notes`) are reused for the skill case shape with NO schema change (see §9 Contracts mapping below).
- **New shared contract file** `contracts/skill-eval.ts` (additive; does not touch `contracts/eval-batch.ts`, which is agent-eval-only and untouched).
- **Client**: full rewrite of `client/src/app/skills/_components/SkillDetail/EvalsTab.tsx` (currently ~150 lines, minimal case list with a disabled Run button) into a case-list + metrics-strip + Case Editor + host-agent-selector layout, following the agent-eval `EvalsTab`/`EvalMetrics`/`CaseList`/`CaseEditor` structure as the UI precedent (adapted vocabulary: judge score / grounding pass rate / cases passing, not recall/precision/citation-accuracy). New `client/src/lib/hooks/skills.ts` additions (extending the existing file, not a new one) for run/batch/host-agent-list hooks.
- **Reused, not modified**: `reviewer-core`'s `reviewPullRequest()` (same call type the agent-eval orchestrator and real reviews use), `reviewer-core`'s `toJsonSchema`/`parseWithRepair` (for the judge's structured output), `container.agentsRepo.getById`/`.linkedSkills()` (already a general-purpose cross-cutting facade — confirmed via `server/insights.md`'s 2026-07-05 entry; no new `Container` getter needed), the existing `SkillsRepository`/`SkillsService` (untouched — case CRUD stays where it is, this plan only adds run/history alongside it).

## 3. Skills & Patterns Applied

**`backend-onion-architecture`:**
- New capability = new files inside the existing `skills/` module (`eval-routes.ts`, `eval-service.ts`, `eval-orchestrator.ts`, `eval-repository.ts`, `eval-scoring.ts`), registered as one additional sub-plugin in `modules/index.ts` (mirrors the `smart-diff.routes.ts` sub-plugin precedent already used for `reviews/` — see `server/insights.md`'s 2026-06-30 Pattern entry) — no auto-discovery.
- Every repository query workspace-scoped: `skill_eval_batches.workspace_id` directly; `eval_runs` reads scoped transitively through `eval_cases.workspace_id` or `skill_eval_batches.workspace_id` (R1).
- Adapters only via `container` — `container.llm(provider)` for both the host agent's review call and the judge call; never a concrete `LLMProvider` class import in `eval-service.ts`/`eval-orchestrator.ts` (R2).
- `AppError`/`NotFoundError`/`ValidationError` for all expected failures (R3).
- Module import isolation (R6): the new skill-eval files import only their own module's files, `@devdigest/shared`, `../../platform/container`, `../../db/schema`, `../_shared/`. Cross-module needs (host agent's config, linked skills) go through `container.agentsRepo` — never a direct `agents/repository.js` import.

**`typescript-expert`:**
- `z.infer` for every new Zod contract in `contracts/skill-eval.ts`.
- Discriminated unions for case `last_run_status` (`never_run | passed | failed_grounding | failed_judge | error`) and batch `status` (`clean | degraded`) / `kind` (`full | calibration`) — exhaustive switches in the service/helpers layer, never string-comparison chains.
- `noUncheckedIndexedAccess` is on — any array/Record index access in scoring (e.g. iterating `practices[]`/`grounding[]`) must handle `T | undefined` explicitly.

**`zod`:**
- One schema drives both route validation and TS types (`fastify-type-provider-zod`).
- Enums for `owner_kind` (existing), batch `kind`/`status`, case `last_run_status`.
- `safeParse`-style validation for the judge's structured-output parse path (via `reviewer-core`'s `parseWithRepair`, which already returns a structured result rather than throwing past the boundary).

**`drizzle-orm-patterns`:**
- New table via `pgTable()` in `server/src/db/schema/eval.ts` (same file as `evalBatches`/`evalRuns` — this is additive to an existing schema file, not a new one), `defaultRandom()` uuid PK, `.references(() => ..., { onDelete: 'cascade' })` for FKs, matching the existing `evalBatches` table's exact shape.
- Explicit indexes on new FK columns (`skill_eval_batches.skill_id`, `.host_agent_id`, `.workspace_id`, and `eval_runs.skill_batch_id`) — Postgres does not auto-index FK columns; mirrors `eval_batches_agent_id_idx`/`eval_batches_workspace_id_idx`/`eval_runs_batch_id_idx` exactly.

**`postgresql-table-design`:**
- `skill_eval_batches.snapshot_identity` as `jsonb NOT NULL` (opaque fingerprint object, never queried by content) — mirrors `eval_batches.agent_snapshot` exactly.
- `TIMESTAMPTZ` for `ran_at` (existing `now()`-default convention).
- `doublePrecision` for `judge_score`/`grounding_pass_rate`/`cost_usd` — matches `eval_batches`'s existing numeric column types, not `NUMERIC`.

**`react-best-practices`:**
- `EvalsTab` composed of small presentational sub-components (`SkillEvalMetrics`, `SkillCaseList`, `SkillCaseRow`, `SkillCaseEditor`, `SkillEvalBatchHistory`, `HostAgentSelect`) — each under ~200 lines, container fetches via hooks, presentational components receive props only.
- All mutations (`useRunSkillEvalBatch`, `useCreateSkillEvalCase` (already exists, extended), `useUpdateSkillEvalCase` (new), `useDeleteSkillEval` (already exists)) live in `client/src/lib/hooks/skills.ts` — never inline `fetch` in a component.
- Derive `last_run_status` display strictly from the server-provided field — no client-side re-derivation.

**`next-best-practices`:** not directly triggered — the Evals tab is a client-side tab inside the existing `skills/[id]`-equivalent client page (`SkillDetail` is rendered from a client-side list/detail split, not a new route segment); no Server Component/Server Action boundary is crossed.

**`frontend-architecture`:**
- New sub-components live co-located under `SkillDetail/_components/EvalsTab/` (the current `EvalsTab.tsx` is a flat file directly in `SkillDetail/` alongside `ConfigTab.tsx` etc. — this plan promotes it to its own `_components/EvalsTab/` folder with children, matching the richer nested pattern already established by the agent-eval `AgentEditor/_components/EvalsTab/_components/*` precedent) — no premature promotion to a cross-route `shared/` location.

**`security`:**
- A03/Injection surface: case fixtures (diff/prompt text) are the same trust class as a real PR diff already routed through the existing prompt-assembly wrapping (`assemblePrompt()`'s `<untrusted>` delimiting + `INJECTION_GUARD`, applied inside `reviewPullRequest()` itself) — no new sanitization layer; the skill-eval orchestrator never bypasses this, it only supplies a synthetic diff fixture instead of a real PR diff, exactly as the agent-eval orchestrator already does.
- A03/Injection surface (NEW for this feature, not present in agent-eval): the review output text fed into `patternMatch()` and the practices judge is itself LLM-generated (not directly attacker-authored) but is treated as inert data by both — the judge's prompt structure (rubric + practices + output, binary pass/fail, verbatim-evidence requirement) never treats the judged output as an instruction stream. No `dangerouslySetInnerHTML` anywhere in the new client components (React JSX auto-escaping is the safety net for case `name`/`notes` free text).
- A06/Insecure Design (rate limiting): the skill-eval run route gets `rateLimit: { max: 2, timeWindow: '1 minute' }` keyed **per-workspace** (matching the ALREADY-LIVE agent-eval route's `keyGenerator: async (req) => \`eval-run:${workspaceId}\`` pattern — stronger than a plain per-IP default) plus a `runWithConcurrencyCap`-style concurrency cap of 3 concurrent case-runs within one batch (ported from `eval/run-orchestrator.ts`'s private `runWithConcurrencyCap` helper — module-local, not imported cross-module, per the existing `server/insights.md` entry on redeclaring identically-shaped local types rather than cross-module type imports).
- A01/Broken Access Control: every skill-eval route resolves `workspaceId` via `getContext()` and every repository method takes and enforces it — cross-workspace requests behave as not-found, never leak data (AC-35, AC-36).

## 4. Project Constraints

- **New DB changes only via a new numbered migration; never alter an existing column.** The migration `CREATE TABLE skill_eval_batches` + `ALTER TABLE eval_runs ADD COLUMN skill_batch_id` (nullable) — `eval_cases`, `eval_batches`, and every existing `eval_runs` column are untouched.
- **Naming discipline — `patternMatch` vs `groundFindings` (CRITICAL, do not conflate):** this spec's `grounding[]` substring-presence gate (a NEW, skill-eval-specific concept, scored by a NEW function named `patternMatch` — matching the harness's own naming in `evals/src/scoring/pattern-match.ts`) is UNRELATED to `reviewer-core`'s mandatory citation gate `groundFindings()` (which validates that findings cite real diff lines, and is never touched, never bypassed, and stays fully out of scope for this feature). Both use the English word "grounding" for different things. To prevent confusion:
  - Name the new server-side function `patternMatch()`, never `groundingGate()` or anything containing "ground" as a verb.
  - Name the case field `grounding: string[]` only in the shared contract / DB JSON shape (matching the spec's own vocabulary, AC-20/AC-21/AC-27) — never in a function/class identifier.
  - Any code comment near the new scoring logic must explicitly state "not to be confused with `reviewer-core`'s `groundFindings()` citation gate, which remains mandatory and untouched in the underlying review call."
  - `reviewPullRequest()` (called once per case by the skill-eval orchestrator) still runs `groundFindings()` internally exactly as it always does — this plan never bypasses it, per the root AGENTS.md's "Grounding is mandatory" rule. The skill-eval scoring described in this plan is a SEPARATE, ADDITIONAL two-tier check applied AFTER `reviewPullRequest()` returns its (already-grounded) output text.
- **Adapters only via `container`** — the skill-eval orchestrator resolves the host agent's LLM via `container.llm(hostAgent.provider)` exactly as `EvalRunOrchestrator.runOneCase` already does; the judge call resolves its own provider the same way (see Step 3 for the judge-provider default).
- **Every repository query workspace-scoped** — `skill_eval_batches.workspace_id` directly; `eval_cases`/`eval_runs` reads scoped transitively, exactly mirroring the live `eval/repository.ts`'s documented scoping discipline.
- **`AppError` for all expected failures** — `NotFoundError` for missing skill/host-agent/case/batch, `ValidationError` for a malformed case (missing both `practices` and `grounding`, AC-2) or an out-of-range `threshold` (AC-39).
- **Secrets via `SecretsProvider` only** — not directly touched; `container.llm(...)` already handles provider API key resolution internally.
- **Shared types added to `server/src/vendor/shared/contracts/skill-eval.ts` AND mirrored byte-identically into `client/src/vendor/shared/contracts/skill-eval.ts` in the SAME step** — these are two physically separate file trees with no sync script (documented repeatedly in both `insights.md` files); a step that edits only the server copy silently breaks client typecheck until manually mirrored.
- **`reviewer-core` stays side-effect-free** — no new code added to `reviewer-core/`; the skill-eval module calls the existing exported `reviewPullRequest()`, `toJsonSchema()`, and `parseWithRepair()` from the server side. The new `patternMatch()`/`judgePractices()` scoring logic lives in `server/src/modules/skills/eval-scoring.ts`, never in `reviewer-core/`.
- **Grounding (citation gate) is mandatory, never bypassed** — `reviewPullRequest()` is called unmodified per case; this feature's own `patternMatch()`/judge scoring is a separate, additional layer applied to the already-grounded output text, not a replacement for or a bypass of `groundFindings()`.
- **Rate-limit/concurrency precedent reuse** — 2 req/min **per-workspace-keyed** (not per-IP), concurrency cap 3, matching the LIVE `eval/routes.ts`'s `POST /agents/:id/evals/run` exactly (not the older per-IP default from the superseded planning doc).
- **Idempotent seed** — the ≥5 hand-authored demo cases in `seed.ts` use fixed UUID literals + `.onConflictDoNothing()`, exactly matching the proven `eval_cases` agent-eval seed pattern (`server/insights.md` 2026-07-06 entry on new-side diff line numbering — apply the same hand-tracing discipline if any case's `grounding[]` substrings are line-number-sensitive, though grounding here is a plain substring check against review TEXT, not diff line ranges, so this specific pitfall does not directly recur — still verify each case's `input_diff` parses via `parseUnifiedDiff` before committing it).
- **User rules (this session):** commits are made by the user, not by any implementer — every step below ends with a suggested commit message only. Do not start or restart `:3001`/`:3000` — the user runs their own dev servers; any step needing a server restart (schema change, new module registration) must say so as an explicit operational note, never execute it.

---

## 5. Implementation Steps

**Parallelization map:**
```
Wave 1: Step 1 (migration + schema)  ∥  Step 2 (shared contracts, server+client)  ∥  Step 3 (scoring — pure functions, patternMatch + judgePractices)
Wave 2: Step 4 (repository)  [depends on 1, 2]
Wave 3: Step 5 (service + orchestrator)  [depends on 3, 4]
Wave 4: Step 6 (routes + module registration)  [depends on 5]
Wave 5: Step 7 (client hooks)  ∥  Step 8 (EvalsTab UI + Case Editor)  ∥  Step 9 (host-agent selector)
        [all depend on Wave 4's routes/contracts]
Wave 6: Step 10 (seed data)  ∥  Step 11 (server hermetic tests sweep + operational restart note)
        [Step 10 depends on Wave 1+Wave 4; Step 11 depends on Wave 4]
```

Note on Wave 5 width: Step 7 (hooks) is listed alongside Step 8/9 rather than strictly before them because the hook function signatures are fully pinned in Step 7's spec below — an implementer on Step 8/9 can code against the documented signatures without waiting for Step 7 to literally finish, exactly as the agent-eval plan's precedent allowed. If the multi-agent scheduler enforces strict intra-wave ordering, promote Step 7 to run first within Wave 5.

Note on Step 9: a `HostAgentSelect` component is its own step (not folded into Step 8) because its only dependency is the ALREADY-EXISTING `GET /agents` route (`client/src/lib/hooks/agents.ts`'s `useAgents()` — no new server work at all for this step) — it is genuinely independent of Steps 7/8's skill-eval-specific work and has a fully disjoint owned path.

---

### Step 1: Database migration — `skill_eval_batches` table + `eval_runs.skill_batch_id` column

**Dependencies:** none
**Owned paths:** `server/src/db/schema/eval.ts` (extended — new table added alongside `evalBatches`/`evalRuns`), `server/src/db/migrations/00XX_skill_eval_batches.sql` (new, exact number assigned by `pnpm db:generate`), `server/src/db/migrations/meta/00XX_snapshot.json` (new), `server/src/db/migrations/meta/_journal.json` (updated)

**What to do:**
1. In `server/src/db/schema/eval.ts`, add a new `skillEvalBatches` table definition, placed directly after the existing `evalBatches` table:
   ```
   export const skillEvalBatches = pgTable(
     'skill_eval_batches',
     {
       id: uuid('id').primaryKey().defaultRandom(),
       workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
       skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
       hostAgentId: uuid('host_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
       kind: text('kind', { enum: ['full', 'calibration'] }).notNull(),
       // Null ONLY while unsealed (row inserted before case-runs execute).
       // Sealed to 'clean' | 'degraded' once every case-run in the batch completes
       // (mirrors eval_batches.status's exact null-until-sealed convention).
       status: text('status', { enum: ['clean', 'degraded'] }),
       // Fingerprint of (skill.body + skill.version + host agent's model + host
       // agent's id) at run time — AC-17. Never derived from skill body alone.
       snapshotIdentity: jsonb('snapshot_identity').notNull(),
       model: text('model').notNull(), // host agent's model at run time, display metadata
       judgeScore: doublePrecision('judge_score'),
       groundingPassRate: doublePrecision('grounding_pass_rate'),
       casesPassing: integer('cases_passing'),
       casesTotal: integer('cases_total'),
       costUsd: doublePrecision('cost_usd'),
       ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
     },
     (t) => ({
       skillIdx: index('skill_eval_batches_skill_id_idx').on(t.skillId),
       hostAgentIdx: index('skill_eval_batches_host_agent_id_idx').on(t.hostAgentId),
       workspaceIdx: index('skill_eval_batches_workspace_id_idx').on(t.workspaceId),
     }),
   );
   ```
   Import `skills` from `./skills.js` at the top of `eval.ts` (new import — `eval.ts` currently imports `workspaces`, `pullRequests`, `agents` but not `skills`). Import `integer` from `drizzle-orm/pg-core` if not already imported in this file (check the existing import line first).
2. Add a new nullable column to the EXISTING `evalRuns` table definition — append it after the existing `batchId` column, do not reorder or touch any other existing column:
   ```
   skillBatchId: uuid('skill_batch_id').references(() => skillEvalBatches.id, { onDelete: 'set null' }),
   ```
   Add a matching index in the same `(t) => ({...})` index block: `skillBatchIdx: index('eval_runs_skill_batch_id_idx').on(t.skillBatchId)`.
3. Run `cd server && pnpm db:generate`. Inspect the emitted SQL: it must contain exactly one `CREATE TABLE skill_eval_batches` and one `ALTER TABLE eval_runs ADD COLUMN skill_batch_id` (plus the new indexes) — no other table's DDL, and no `ALTER` touching any existing column type/nullability. If drizzle-kit reports a snapshot collision or emits anything unexpected, stop and diagnose before proceeding (per `server/insights.md`'s documented snapshot-chain-drift entries — verify with a dry run before trusting the chain).
4. Run `cd server && pnpm db:migrate` against the local dev DB and confirm no errors.
5. Operational note (do NOT execute yourself if the user's own `:3001` is already running — this only applies before the user next restarts it): the running API process must be restarted after this migration for the new table/column to be usable by later steps' route-level manual smoke checks. Say so explicitly in the step's completion report; do not restart the server yourself.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `pnpm db:migrate` applies cleanly
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d skill_eval_batches"` shows the new table with all columns and indexes
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d eval_runs"` shows the new nullable `skill_batch_id` column; every pre-existing column unchanged
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "\d eval_batches"` and `"\d eval_cases"` show NO changes at all (untouched by this migration)

**Commit:** `feat(db): add skill_eval_batches table and eval_runs.skill_batch_id column`

---

### Step 2: Shared contracts — skill eval case, batch, per-case outcome, judge verdict shapes (server + client, mirrored)

**Dependencies:** none
**Owned paths:** `server/src/vendor/shared/contracts/skill-eval.ts` (new), `client/src/vendor/shared/contracts/skill-eval.ts` (new, byte-identical mirror), `server/src/vendor/shared/index.ts` (barrel export addition), `client/src/vendor/shared/index.ts` (barrel export addition)

**What to do:**
1. Create `server/src/vendor/shared/contracts/skill-eval.ts` — additive only, does not touch `contracts/eval-batch.ts` (agent-eval, untouched). Define, using `z.object` + `z.infer` pairing per the existing `eval-batch.ts` pattern:
   - `SkillEvalCaseSource`: `z.enum(['finding', 'manual'])` (mirrors `EvalCaseSource` — a separate type, since these are conceptually distinct wire contracts even though the values are identical strings; do NOT import/reuse `EvalCaseSource` from `eval-batch.ts` across files, to keep the two features' contracts fully independent per the spec's explicit non-goal of not unifying the two methodologies).
   - `PracticeVerdict`: `{ practice: z.string(), passed: z.boolean(), evidence: z.string() }` — the per-practice judge result shape (mirrors `evals/src/scoring/llm-judge.ts`'s `Verdict.results[]` element, adapted to snake_case-free single-word fields already matching the wire convention this repo uses for judge output).
   - `JudgeVerdict`: `{ score: z.number().min(0).max(1), results: z.array(PracticeVerdict) }` — the full verdict contract (matches the coordinator-confirmed shape `{score, results:[{practice,pass,evidence}]}`; field is named `passed` not `pass` to match the harness's own `Verdict.results[].passed` field name exactly, avoiding a needless rename that would only sow confusion when cross-referencing `evals/src/scoring/llm-judge.ts`).
   - `SkillEvalCaseListItem` (case-list contract, spec §9): `{ id, skill_id, name, source: SkillEvalCaseSource, source_finding_id: z.string().nullish(), source_pr_number: z.number().int().nullish(), fixture: z.string(), practices: z.array(z.string()), grounding: z.array(z.string()), threshold: z.number().min(0).max(1), last_run_status: z.enum(['never_run','passed','failed_grounding','failed_judge','error']), last_run_summary: z.string().nullish(), last_host_agent_id: z.string().nullish() }`.
   - `SkillEvalCaseCreateInput`: `{ skill_id: z.string(), name: z.string().min(1), fixture: z.string(), practices: z.array(z.string()).default([]), grounding: z.array(z.string()).default([]), threshold: z.number().min(0).max(1).default(0.6), notes: z.string().nullish() }` — validated further at the service layer for AC-2 (at least one of `practices`/`grounding` non-empty) and AC-3 (non-empty `fixture`), since a cross-field rule (AC-2) is awkward to express as a pure Zod refinement across two independent optional-with-default arrays; the service throws `ValidationError` explicitly instead.
   - `SkillEvalBatchKind`: `z.enum(['full', 'calibration'])`.
   - `SkillEvalBatchStatus`: `z.enum(['clean', 'degraded'])`.
   - `SkillEvalBatch`: `{ id, skill_id, host_agent_id, kind: SkillEvalBatchKind, status: SkillEvalBatchStatus.nullable(), snapshot_identity: z.unknown(), model: z.string(), judge_score: z.number().nullable(), grounding_pass_rate: z.number().nullable(), cases_passing: z.number().int().nullable(), cases_total: z.number().int(), cost_usd: z.number().nullable(), ran_at: z.string() }`.
   - `SkillEvalBatchCaseOutcome` (per-case outcome, spec §9): `{ case_id, case_name: z.string(), status: z.enum(['passed','failed_grounding','failed_judge','error']), grounding_missing: z.array(z.string()), judge_score: z.number().nullable(), judge_evidence: z.array(PracticeVerdict).nullable(), cost_usd: z.number().nullable(), error_message: z.string().nullish() }`.
   - `SkillEvalBatchDetail`: `SkillEvalBatch.extend({ cases: z.array(SkillEvalBatchCaseOutcome) })`.
   - `SkillEvalRunBatchRequest`: `{ case_ids: z.array(z.string().uuid()).min(1).nullish(), host_agent_id: z.string().uuid() }` — `host_agent_id` is REQUIRED on every run request (AC-11's default is a CLIENT-side pre-fill, not a server-side implicit default — the server always receives an explicit id; see Step 8/9 for where the client resolves and pre-fills the default).
   - `SkillEvalRunAcceptedResponse`: `{ batch_id: z.string().uuid() }` (202 response, mirrors `EvalRunAcceptedResponse`).
   - `SkillEvalCaseListResponse`: `{ cases: z.array(SkillEvalCaseListItem) }` (no exclusion-count envelope needed here — unlike the agent-eval side, there is no cross-owner-kind exclusion concept for a skill's OWN case list; AC-1 already scopes strictly to this skill's own `owner_kind='skill'` rows).
2. Export every new type/schema from `server/src/vendor/shared/index.ts`'s barrel. Before adding, `grep` the WHOLE `vendor/shared` dir for each new name (`SkillEvalCaseListItem`, `SkillEvalBatch`, `JudgeVerdict`, etc.) to rule out a collision — per the documented 2026-06-30 `AgentStats` collision mistake in `server/insights.md`. None of the names above are expected to collide with any existing export based on this plan's own codebase scan, but re-verify at implementation time.
3. Copy the exact same file content into `client/src/vendor/shared/contracts/skill-eval.ts` and add the same barrel export line to `client/src/vendor/shared/index.ts` — in the SAME commit, so no intermediate state has a typecheck-broken client.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck` AND `cd client && pnpm typecheck`)
- [ ] `grep -rn "SkillEval\|JudgeVerdict\|PracticeVerdict" server/src/vendor/shared/contracts/` shows no duplicate export name pre-existing outside the new file
- [ ] `diff server/src/vendor/shared/contracts/skill-eval.ts client/src/vendor/shared/contracts/skill-eval.ts` — no output (byte-identical)

**Commit:** `feat(shared): add skill-eval contracts (case, batch, judge verdict, run request)`

---

### Step 3: Scoring — `skills/eval-scoring.ts` (patternMatch gate + practices judge)

**Dependencies:** Step 2 (contract types)
**Owned paths:** `server/src/modules/skills/eval-scoring.ts` (new)

**What to do:**
1. Implement `patternMatch(output: string, expected: string[]): { passed: boolean; missing: string[] }` — a case-insensitive all-substrings-present check, ported directly from `evals/src/scoring/pattern-match.ts`'s algorithm (`output.toLowerCase().includes(e.toLowerCase())` per substring), but returning pass/fail PLUS the list of missing substrings (needed for `EvalBatchCaseOutcome.grounding_missing`, AC-20/AC-21/AC-30's "which grounding terms were missing" summary — the harness's own `patternMatch` only returns a 0..1 fraction, which this feature's UI needs to expand into concrete missing terms). An empty `expected` array returns `{ passed: true, missing: [] }` (AC-20's "no grounding requirement" case — neither pass nor fail contributes to the gate, treated as vacuously satisfied). Zero I/O, zero LLM calls (AC-27, verified by a test asserting no LLM mock is touched).
2. Implement `judgePractices(container: Container, provider: Provider, model: string, output: string, practices: string[]): Promise<JudgeVerdict>` — the ONE real LLM call per judged case (AC-22, AC-27):
   - Build a rubric prompt mirroring `evals/src/scoring/llm-judge.ts`'s `JUDGE_RUBRIC` text exactly in spirit (strict blind evaluator, binary PASS/FAIL per practice, PASS only with a verbatim quote as evidence) — adapted to request structured JSON output via the schema below rather than free-text JSON-in-a-string, since the server has `reviewer-core`'s `toJsonSchema`/`parseWithRepair` available (the CLI harness does not use structured-output mode; the server-side implementation upgrades to it, since it's already the established pattern for the review pipeline itself).
   - Build the request schema as `z.object({ results: z.array(z.object({ practice: z.string(), passed: z.boolean(), evidence: z.string() })) })`, call `reviewer-core`'s `toJsonSchema(schema, 'JudgeVerdict')` to get the JSON Schema, pass it to `container.llm(provider)`'s structured-completion call (check the exact `LLMProvider` interface method name in `server/src/vendor/shared/contracts/knowledge.ts` or wherever `LLMProvider` is declared — likely a `completeStructured`-style method; if the interface only exposes a plain `complete()` returning text, use `reviewer-core`'s `parseWithRepair(schema, rawText)` to validate/repair the response instead of assuming a structured-mode method exists on every provider — confirm the exact provider interface shape before writing this call, since this is new server-side ground not previously exercised by any other module for a "judge" style call).
   - Compute `score = passed_count / total_count` (division-by-zero guard: `total_count` is always `practices.length` which is guaranteed non-zero by the caller only invoking this when `practices.length > 0` — AC-22's precondition).
   - Return `{ score, results }` matching the `JudgeVerdict` contract from Step 2.
3. Implement `casePassed(groundingResult: { passed: boolean }, hasGrounding: boolean, judgeResult: JudgeVerdict | null, hasPractices: boolean, threshold: number): boolean` — AC-24's exact rule: passed when (grounding passed OR no grounding requirement) AND (no practices to judge OR judge score >= threshold).
4. Add an explicit code comment at the top of the file (per the Constraints section's naming-discipline requirement): `// patternMatch() here is UNRELATED to reviewer-core's groundFindings() citation gate — see docs/plans/2026-07-06-skill-eval-pipeline.md §4 Constraints for the naming-collision note. groundFindings() runs inside reviewPullRequest() itself and is never touched or bypassed by this file.`
5. Write `server/test/skill-eval-scoring.test.ts` (hermetic, no mocks needed for `patternMatch` — pure function; `MockLLMProvider` from `src/adapters/mocks.ts` for `judgePractices`) covering: all-substrings-present pass, one-substring-missing fail with the correct `missing[]` list, empty-`grounding`-array vacuous pass, a full practices judge call returning a mixed pass/fail verdict (mocked structured response), `casePassed()`'s four AC-24 branches (grounding fail short-circuits regardless of judge; no-grounding + no-practices passes trivially; grounding pass + judge >= threshold passes; grounding pass + judge < threshold fails), and an explicit assertion/comment confirming `patternMatch` never touches any LLM mock.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] `cd server && pnpm exec vitest run test/skill-eval-scoring.test.ts` passes
- [ ] Test file contains an explicit assertion that `patternMatch` alone makes zero LLM provider calls (AC-27, §7 Non-functional)

**Commit:** `feat(skills): add eval scoring (patternMatch gate, practices judge, casePassed rule)`

---

### Step 4: Repository — `skills/eval-repository.ts`

**Dependencies:** Step 1 (schema), Step 2 (contract types for return-shape mapping)
**Owned paths:** `server/src/modules/skills/eval-repository.ts` (new)

**What to do:**
1. Create `SkillEvalRepository` class, constructor takes `Db` (matches the canonical pattern — instantiated with `container.db`, never the whole `Container`).
2. Implement, each query workspace-scoped:
   - `listCases(workspaceId: string, skillId: string): Promise<EvalCaseRow[]>` — `SELECT * FROM eval_cases WHERE workspace_id = $1 AND owner_kind = 'skill' AND owner_id = $2` (reuses the EXISTING `eval_cases` table/rows — no new case table).
   - `getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | null>` — `owner_kind='skill'` filter included.
   - `insertCase(data: EvalCaseInsert): Promise<EvalCaseRow>` — same `eval_cases` insert shape the existing `SkillsRepository.insertEvalCase` already uses (`ownerKind: 'skill'`), but this new repository OWNS the run-adjacent read paths (`latestRunForCase`, etc.); case CRUD write paths stay in the existing `SkillsRepository` per the module's established split — do NOT duplicate `insertCase`/`deleteCase` here if `SkillsRepository` already covers them adequately; instead, this repository's `insertCase`/`updateCase` variants exist ONLY if Step 5's service needs a shape the existing `SkillsRepository` methods don't provide (specifically: `expected_output` here holds `{practices, grouping: grounding, threshold}` JSON, not the agent-eval's `Expectation[]` shape — check whether `SkillsRepository.insertEvalCase`'s existing signature already accepts an arbitrary `expected_output: unknown` payload, which it does per the current code at `server/src/modules/skills/repository.ts:280-301` — if so, REUSE `SkillsRepository.insertEvalCase`/`.updateCase`(new)/`.deleteEvalCase` directly from `skills/eval-service.ts` rather than re-implementing case CRUD in this new repository; this repository then owns ONLY the run/batch/history-specific queries listed below).
   - `latestRunForCase(caseId: string): Promise<EvalRunRow | null>` — most recent `eval_runs` row for a case (via `skill_batch_id IS NOT NULL`, ordered by `ran_at DESC`), used for `last_run_status`/`last_run_summary`.
   - `insertBatch(data: SkillEvalBatchInsert): Promise<SkillEvalBatchRow>`.
   - `insertRun(data: EvalRunInsert): Promise<EvalRunRow>` — inserts into the EXISTING `eval_runs` table with the new `skillBatchId` column populated (`batchId` left null — these are mutually exclusive: an `eval_runs` row belongs to EITHER an agent-eval batch OR a skill-eval batch, never both).
   - `updateBatchAggregate(batchId: string, metrics: { judgeScore: number | null; groundingPassRate: number | null; casesPassing: number | null; casesTotal: number; costUsd: number | null; status: 'clean' | 'degraded' }): Promise<void>`.
   - `listBatchHistory(workspaceId: string, skillId: string): Promise<SkillEvalBatchRow[]>` — `WHERE workspace_id = $1 AND skill_id = $2 ORDER BY ran_at DESC`.
   - `getBatch(workspaceId: string, batchId: string): Promise<SkillEvalBatchRow | null>`.
   - `runsForBatch(batchId: string): Promise<EvalRunRow[]>` — `WHERE skill_batch_id = $1`.
3. All methods take `workspaceId` explicitly and include it in every `WHERE` clause (or, for `eval_runs`/case-adjacent reads that have no direct `workspace_id` column, scope transitively through an already-workspace-verified `skillId`/`batchId` the caller resolved first) — R1, no exceptions.
4. Do not import `skills/service.ts` or any other module's repository — infrastructure-only.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Hermetic test `server/test/skill-eval-repository.test.ts` (new) exercises each method against a fake/mocked `db`, following the existing "sniff by requested column keys" convention documented in `server/insights.md`
- [ ] Every method's SQL includes a `workspace_id` filter or a transitive-scope justification documented inline — self-audit each `.where()` clause

**Commit:** `feat(skills): add SkillEvalRepository (workspace-scoped batch/run queries)`

---

### Step 5: Service + orchestrator — `skills/eval-service.ts`, `skills/eval-orchestrator.ts`

**Dependencies:** Step 3 (scoring), Step 4 (repository)
**Owned paths:** `server/src/modules/skills/eval-service.ts` (new), `server/src/modules/skills/eval-orchestrator.ts` (new)

**What to do:**
1. `SkillEvalService` constructor takes `Container`, instantiates `this.repo = new SkillEvalRepository(container.db)` and `this.orchestrator = new SkillEvalOrchestrator(container)`.
2. `listCases(workspaceId, skillId)`: reuses `container.skillsRepo` (already exposed on `Container` per `platform/container.ts`'s `get skillsRepo()`) to verify the skill exists in this workspace (404 if not — AC-1's scoping), then `this.repo.listCases` + `this.repo.latestRunForCase` per case to build `SkillEvalCaseListItem[]` (parse the existing `eval_cases.expected_output` JSON into `{practices, grounding, threshold}`, defaulting `threshold` to 0.6 when absent — AC-10).
3. `createCaseManual(workspaceId, skillId, input: SkillEvalCaseCreateInput)` (AC-2, AC-3): validate `input.fixture.trim().length > 0` (AC-3 — inline validation error, no persistence on failure) and `input.practices.length > 0 || input.grounding.length > 0` (AC-2) BEFORE calling the repository — these are exactly the two cross-field/non-empty rules that don't fit cleanly as Zod schema constraints alone. On success, insert via the EXISTING `container.skillsRepo`-equivalent path or the new repository per Step 4's reuse decision, with `expected_output: { practices: input.practices, grounding: input.grounding, threshold: input.threshold ?? 0.6 }` and `input_meta: { source: 'manual' }`.
4. `createCaseFromFinding(workspaceId, skillId, findingId)` (AC-4, AC-5, AC-6): **the skill is explicitly passed as a parameter, never inferred** (AC-4 — the route requires the caller to specify `skillId`, mirroring the agent-eval pipeline's finding→case promotion but with the crucial difference that the TARGET skill is an explicit author choice, not auto-attributed from the finding's owning agent). Resolve the finding via `container.reviewRepo.findingContext(findingId)` (the EXISTING cross-cutting facade — confirmed live and general-purpose per `server/insights.md`'s 2026-07-05 entry; never a direct `reviews/repository.js` import, R6). Verify `ctx.pull.workspaceId === workspaceId` (404 otherwise). Derive:
   - AC-6 (accepted finding): default `practices: ["review output identifies the ${finding.category ?? 'issue'} in ${finding.file}"]` (a positive expectation templated deterministically from the finding's own fields — zero LLM calls, per the spec's Inputs/Provenance table), default `grounding: [key terms drawn from finding.title/finding.rationale — e.g. a short deterministic extraction, not an LLM summary]`.
   - AC-7 (dismissed finding): default `practices: ["review output does NOT flag ${finding.file} for ${finding.category ?? 'this issue'}"]` (a negative expectation — judged by the practices judge, since AC-7 explicitly notes a substring-presence `grounding[]` check cannot express absence); `grounding: []` for this branch (no substring-presence gate can assert a negative).
   - Reuse the EXACT file-scoped diff extraction already implemented in `EvalService.createCaseFromFinding` (`server/src/modules/eval/service.ts:122-142`): `container.reviewRepo.getPrFiles(pull.id)` → reconstruct the file's own diff hunk(s) only (AC-5 — not the whole PR diff) via `parseUnifiedDiff`. This exact reconstruction logic may be extracted to a small shared helper in `skills/eval-service.ts` (duplicated, not cross-module-imported, per R6 — a module may not import another module's internals even for a small helper) or literally re-written inline; either is acceptable, but it MUST behave identically (same "no diff available for this file" `ValidationError` guard).
   - `expectation_type` derivation: `finding.acceptedAt` → AC-6 branch; `finding.dismissedAt` → AC-7 branch; neither → `throw new ValidationError('Finding must be accepted or dismissed first')` (mirrors the agent-eval precedent exactly).
   - Provenance: `input_meta: { source: 'finding', source_finding_id: findingId, source_pr_number: pull.number }`.
5. `updateCase(workspaceId, skillId, caseId, input: SkillEvalCaseCreateInput)` (AC-39's threshold edit applies here too): same AC-2/AC-3 validation as `createCaseManual`; additionally reject `threshold` outside `[0, 1]` inline (Zod's `.min(0).max(1)` on the shared contract already rejects this at the route boundary before the service is even reached — service-layer re-validation is defense-in-depth, not the primary gate).
6. `deleteCase(workspaceId, skillId, caseId)`: existence/ownership check (`owner_kind='skill' AND owner_id=skillId`), then delete. Client-side confirmation already happened (AC-9).
7. `SkillEvalOrchestrator.startBatch(workspaceId, skillId, hostAgentId, caseIds?: string[])` (mirrors `EvalRunOrchestrator.startBatch` structurally):
   - Resolve the skill via `container.skillsRepo.getById(workspaceId, skillId)` → 404 if missing.
   - Resolve the host agent via `container.agentsRepo.getById(workspaceId, hostAgentId)` → 404 if missing (AC-11's "a host agent must be selected" — the route always receives an explicit `host_agent_id`, defaulting happens client-side per Step 2's contract decision).
   - Resolve target cases (full set or `caseIds` subset, deduped via `Set`, same "unknown ids silently dropped, zero-resolved throws" rule as the agent-eval orchestrator) → determine `kind: 'full' | 'calibration'` by the same strict-subset test.
   - Resolve the host agent's currently linked skills via `container.agentsRepo.linkedSkills(hostAgentId)`, filter `enabled`, map to `.body` — then APPEND the skill-under-test's OWN body to this list (AC-13's marginal contribution — the skill under test is added ALONGSIDE the host agent's existing linked skills, never replacing them; if the host agent has zero other linked skills, the run proceeds with only the skill-under-test attached — not an error, per the spec's edge-case table).
   - Compute `snapshotIdentity` (AC-17): a deterministic fingerprint object of `{ skillBody: skill.body, skillVersion: skill.version, hostAgentModel: hostAgent.model, hostAgentId: hostAgent.id }` — never from skill body alone; two batches differ in identity if EITHER the skill version changes OR the host agent changes (even with the same skill version), per the spec's edge-case table rows on this exact point.
   - Insert the `skill_eval_batches` row up front with `status: null` (unsealed) — same "never readable as finished before it is" discipline as the agent-eval orchestrator.
   - Return `{ batch, skill, hostAgent, skillBodies (host agent's linked + this skill appended), targetCases }`.
8. `SkillEvalOrchestrator.executeBatch(batch, skill, hostAgent, skillBodies, targetCases, log?)` (mirrors `EvalRunOrchestrator.executeBatch`):
   - `runWithConcurrencyCap(targetCases, 3, async (caseRow) => { ... })` — concurrency cap 3, ported as a private module-local helper (do NOT cross-import `eval/run-orchestrator.ts`'s helper — redeclare locally, per R6 and the documented "two modules can independently define an identically-shaped type/helper" precedent in `server/insights.md`).
   - Per case: call `reviewPullRequest({ systemPrompt: hostAgent.systemPrompt, model: hostAgent.model, diff: parseUnifiedDiff(caseRow.inputDiff ?? ''), llm: await container.llm(hostAgent.provider), strategy: hostAgent.strategy, skills: skillBodies, sessionId: \`skill-eval:${batch.id}:${caseRow.id}\` })` — the SAME call type/shape the agent-eval orchestrator and real reviews use (AC-13, zero new LLM call sites for the review step itself).
   - On success: extract the review's OUTPUT TEXT (confirm the exact field on `ReviewOutcome` that holds renderable text — likely composed from `outcome.review` fields, e.g. via `toReviewPayload()` or a raw concatenation of finding titles/rationales; if `reviewPullRequest()`'s outcome does not already expose a single flat "output text" string, build one deterministically from `outcome.review.findings` (e.g. join each finding's `title` + `rationale` + `file:line`) — confirm the exact available shape while implementing this step, since `patternMatch`/the judge need one string, not a findings array).
   - Run `patternMatch(outputText, caseRow.grounding)` — if it fails (AC-21), record `status: 'failed_grounding'`, `grounding_missing: result.missing`, skip the judge entirely (no LLM call).
   - If grounding passed (or no grounding configured) AND `caseRow.practices.length > 0`: run `judgePractices(...)` — record `judge_score`, `judge_evidence` (the verdict's `results[]`), and `status: casePassed(...) ? 'passed' : 'failed_judge'`.
   - If grounding passed and `caseRow.practices.length === 0`: `status: 'passed'` (AC-24 — no practices to judge, grounding alone determines the outcome).
   - On a per-case runtime failure (provider error/timeout): catch it, record `status: 'error'`, continue the remaining cases (AC-15), mark the eventual batch `status: 'degraded'`.
   - Aggregate ONLY from cases that were NOT `error` (AC-16, AC-25, AC-26): `judge_score` = average of judge scores across cases that REACHED the judging tier (excludes grounding-failed and errored cases, AC-25); `grounding_pass_rate` = count of grounding-passed-or-no-requirement cases / count of non-errored cases (AC-26); `cases_passing` = count of `status === 'passed'`; `cost_usd` = sum of (review call cost + judge call cost, when invoked) across all non-errored cases (AC-33).
   - Seal the batch: `status: anyError ? 'degraded' : 'clean'` (mirrors the agent-eval orchestrator's unconditional-seal-including-calibration fix — see `server/insights.md`'s 2026-07-06 entry on why calibration batches must NOT be left with `status: null`, since the client polls on `status != null` as the completion signal; apply the SAME fix here from the start, not as a later patch).
9. `SkillEvalOrchestrator.runBatch(...)`: synchronous start+execute+seal convenience wrapper for tests only — routes must use `startBatch` + detached `executeBatch` (AC-19).
10. `SkillEvalService` exposes thin wrappers: `startEvalRun`, `executeEvalRun`, `runBatch` (test convenience), `listBatchHistory`, `getBatchDetail`.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Hermetic test `server/test/skill-eval-service.test.ts` using `MockLLMProvider` from `src/adapters/mocks.ts` covering: case-from-finding derivation (accepted vs. dismissed branch — including the AC-7 negative-case wording and empty `grounding`), manual-case AC-2/AC-3 validation (both accept and reject paths), a full-batch run with a mixed passed/failed_grounding/failed_judge case set, a degraded-batch path (one case's mock LLM call throws), calibration-batch kind detection, the marginal-contribution skill-append behavior (assert the host agent's OWN linked skills are still present in the `skills` array passed to the mocked `reviewPullRequest` call, PLUS the skill-under-test's body appended), and the zero-linked-skills edge case (host agent has none — run proceeds with only the skill-under-test, not an error)
- [ ] No raw `Error` thrown anywhere in `eval-service.ts`/`eval-orchestrator.ts` — grep for `throw new Error` returns nothing

**Commit:** `feat(skills): add SkillEvalService and marginal-contribution run orchestrator`

---

### Step 6: Routes + module registration

**Dependencies:** Step 5 (service)
**Owned paths:** `server/src/modules/skills/eval-routes.ts` (new sub-plugin), `server/src/modules/index.ts` (one import + one entry added)

**What to do:**
1. Create `eval-routes.ts` as its own `FastifyPluginAsync` (a sibling sub-plugin to `skills/routes.ts`, mirroring the `smart-diff.routes.ts` precedent for `reviews/` — `server/insights.md`'s 2026-06-30 Pattern entry — since `skills/routes.ts` is already ~220 lines and this feature adds a comparable amount of new route surface; keeping run/history/detail routes in a separate file avoids growing the existing file past a clean single responsibility). `app.withTypeProvider<ZodTypeProvider>()`, instantiate `new SkillEvalService(app.container)`.
2. Routes (all resolve `workspaceId` via `getContext(app.container, req)` first):
   - `PATCH /skills/:id/evals/:caseId` (body: `SkillEvalCaseCreateInput`) → `service.updateCase` (AC-39's threshold edit; full-replacement semantics matching the agent-eval `PATCH` precedent).
   - `POST /findings/:id/evals/skill-case` (body: `{ skill_id: z.string().uuid() }`) → `service.createCaseFromFinding(workspaceId, req.body.skill_id, req.params.id)` (AC-4 — route path distinguishes this from the agent-eval `/findings/:id/evals/case` route; the skill id travels in the BODY, not inferred, since the author must explicitly pick it).
   - `POST /skills/:id/evals/run` (body: `SkillEvalRunBatchRequest`, `config: { rateLimit: { max: 2, timeWindow: '1 minute', keyGenerator: async (req) => { const { workspaceId } = await getContext(container, req); return \`skill-eval-run:${workspaceId}\`; } } }`) → resolve + insert synchronously via `service.startEvalRun`, take `const log = req.log.child({...})` BEFORE responding (Fastify recycles `req.log` after the response is sent — the documented "recycled req.log" mistake), `void service.executeEvalRun(started, log).catch(...)`, `reply.code(202)`, return `{ batch_id }` (AC-11, AC-12, AC-14, AC-18, AC-19).
   - `GET /skills/:id/evals/batches` → `service.listBatchHistory` (AC-32).
   - `GET /skills/:id/evals/batches/:batchId` → `service.getBatchDetail` (AC-32's drill-down; client polls this for run completion, matching the agent-eval `status != null` polling convention).
3. The EXISTING `GET/POST/DELETE /skills/:id/evals` routes in `skills/routes.ts` stay as-is for basic CRUD (already handle the `owner_kind='skill'` shape); this new file adds run/history/detail/edit/from-finding ONLY — no duplicate route paths.
4. Register: add `import skillEvalRoutes from './skills/eval-routes.js';` and a new entry (e.g. `skillEval: skillEvalRoutes,`) to the `modules` record in `server/src/modules/index.ts`, alongside the existing `skills` entry.
5. Zod param schemas: reuse `IdParams` from `../_shared/schemas.js` for `:id`; a small local `CaseIdParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() })` and `BatchIdParams` mirroring the agent-eval route file's exact pattern.

**Verify:**
- [ ] Compiles (`cd server && pnpm typecheck`)
- [ ] Route-level hermetic test `server/test/skill-eval-routes.test.ts` using `buildApp()` + injected mocks (per the `blast-routes.test.ts`/`brief-routes.test.ts` precedent) covering: 200/202 on each route's happy path, 404 on cross-workspace skill/batch/case access, 400 on a case save missing both `practices` and `grounding`, 429 on a rate-limit burst (fire >2 requests to `/skills/:id/evals/run` within the window and assert the 3rd is rejected)
- [ ] Operational note in the completion report: the user's own `:3001` needs a restart to pick up the new module registration before any manual smoke check — do not restart it yourself, just note it

**Commit:** `feat(skills): register skill-eval routes (run, batch history/detail, edit, from-finding)`

---

### Step 7: Client hooks — extend `client/src/lib/hooks/skills.ts`

**Dependencies:** Step 6 (routes must exist for the hooks to target), Step 2 (types)
**Owned paths:** `client/src/lib/hooks/skills.ts` (extended — new hooks appended to the existing file's "Eval cases" section, existing `useSkillEvals`/`useCreateSkillEval`/`useDeleteSkillEval` untouched)

**What to do:**
1. Following the exact pattern already established in this file (React Query, `api.get`/`api.post`/`api.patch`/`api.del` from `src/lib/api.ts`, query-key arrays, `invalidateQueries` on mutation success) and mirroring `client/src/lib/hooks/eval.ts`'s agent-eval hook shapes adapted to the skill-eval routes:
   - `useSkillEvalCases(skillId)` — if `useSkillEvals` already exists and returns the right shape, EXTEND it in place to also surface `last_run_status`/`last_run_summary`/`last_host_agent_id` per the new `SkillEvalCaseListItem` contract rather than adding a parallel duplicate hook; only add a new hook name if the existing one's return shape is incompatible with the new fields (check at implementation time — the current `SkillEvalCase` type in this file already extends `EvalCase` with a `last_run` object, which is a DIFFERENT shape from the new contract's flat `last_run_status`/`last_run_summary` fields, so a rename/reshape of `useSkillEvals`'s query function is very likely required here, not a pure addition).
   - `useUpdateSkillEvalCase(skillId)` → `useMutation` calling `api.patch(\`/skills/${skillId}/evals/${caseId}\`, input)`, invalidates `["skill-evals", skillId]`.
   - `useCreateSkillEvalCaseFromFinding()` → `useMutation` posting `{ skill_id }` to `/findings/${findingId}/evals/skill-case`, invalidates `["skill-evals", skillId]` on success (skillId known from the mutation variables, not from route params, since this hook is called from a FindingCard context that doesn't inherently know which skill tab is open).
   - `useRunSkillEvalBatch(skillId)` → `useMutation` posting `SkillEvalRunBatchRequest` (always includes `host_agent_id`; `case_ids` omitted = full run, present = calibration), invalidates `["skill-evals", skillId]`, `["skill-eval-batches", skillId]` on success.
   - `useSkillEvalBatchHistory(skillId)` → `useQuery(["skill-eval-batches", skillId], () => api.get(\`/skills/${skillId}/evals/batches\`))`.
   - `useSkillEvalBatchDetail(skillId, batchId)` → `useQuery(["skill-eval-batch-detail", skillId, batchId], ..., { enabled: !!batchId })` — used both for the drill-down AND for polling run completion (`status != null`), mirroring `useEvalRunCompletion`'s polling pattern from `client/src/lib/hooks/eval.ts` (check that file's exact polling interval/`refetchInterval` config and reuse the same value here for consistency).
2. All hooks import types from `@devdigest/shared` (Step 2's contract additions) — never redefine local ad-hoc interfaces for these shapes; remove/replace the existing file's local `SkillEvalCase` type alias if it becomes redundant once the shared `SkillEvalCaseListItem` type covers the same shape.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] Existing `hooks/skills.ts` consumers (if any beyond `SkillDetail/EvalsTab.tsx`) still compile after the reshape — `grep -rn "useSkillEvals\b" client/src/` to find all call sites before changing the hook's return shape

**Commit:** `feat(client): add skill-eval React Query hooks (run, batch history/detail, from-finding)`

---

### Step 8: Client UI — EvalsTab rewrite (metrics strip, case list, Case Editor, batch history)

**Dependencies:** Step 7 (hooks), Step 2 (types)
**Owned paths:** `client/src/app/skills/_components/SkillDetail/EvalsTab.tsx` (rewritten to a thin container, following the agent-eval `EvalsTab.tsx`'s container-component pattern), `client/src/app/skills/_components/SkillDetail/_components/EvalsTab/` (new directory — `_components/SkillEvalMetrics/`, `_components/SkillCaseList/`, `_components/SkillCaseRow/`, `_components/SkillCaseEditor/`, `_components/SkillEvalBatchHistory/`, `styles.ts`), `client/messages/en/skills.json` (new `evals.*` translation keys — confirmed currently ABSENT from this file, unlike `agents.json`'s pre-populated `evals.*` set, so every string here is new)

**What to do:**
1. `EvalsTab.tsx` (container): uses `useSkillEvalCases(skill.id)`, `useSkillEvalBatchHistory(skill.id)`. Renders:
   - Empty state (zero cases): CTAs for "+ New eval case" (opens `SkillCaseEditor`) and a hint pointing to the FindingCard "attribute to skill" action (Step 9's sibling work — cross-reference only, no code dependency).
   - `SkillEvalMetrics` (metrics strip, adapted vocabulary per the spec — NOT recall/precision/citation-accuracy): judge score (avg, %), grounding pass rate (%), cases passing (N/M), cost ($) — sourced from the latest batch in `useSkillEvalBatchHistory`'s response (`batches[0]` after confirming sort order is newest-first, matching the server's `ORDER BY ran_at DESC`).
   - `HostAgentSelect` (Step 9's component, imported here) placed above "Run all evals" — the currently-selected host agent id is local component state in `EvalsTab`, defaulting to the workspace's "General Reviewer" agent (see Step 9 for exact default-resolution logic) but re-selectable per run.
   - "Run all evals" button → `useRunSkillEvalBatch(skill.id).mutate({ host_agent_id: selectedHostAgentId })`.
   - `SkillCaseList` / `SkillCaseRow`: status icon for 5 distinct states (never_run / passed / failed_grounding / failed_judge / error — each visually distinct per AC-30, e.g. a different icon+color pairing for failed_grounding vs failed_judge so an author can tell at a glance which tier failed), name, subtitle (`last_run_summary`), practices/grounding count badges, per-row actions: run (▷, calls `useRunSkillEvalBatch` with `case_ids: [case.id], host_agent_id: selectedHostAgentId`), edit (✎, opens `SkillCaseEditor` pre-filled), delete (with a `ConfirmModal` per AC-9, reusing the existing `@/components/confirm-modal` component already used by the agent-eval `EvalsTab`).
   - `SkillEvalBatchHistory`: timestamp, host agent name, model, the three metrics, cost, status pill (clean/degraded/calibration) — server-side persistence only in this feature's scope (AC-32 explicitly says a client-visible history TABLE is not required, but this plan includes a simple one since it's a small addition given the batch-history route already exists and the agent-eval `BatchHistoryTable` is a direct pattern to copy).
2. `SkillCaseEditor` (modal): fixture textarea (reuses the existing simpler Case Editor pattern per the spec's explicit non-goal — NOT the two-panel source-aware redesign used by the agent-eval side), practices list editor (add/remove text rows), grounding substrings list editor (add/remove text rows), threshold number input (0–1, default 0.6, inline validation error on out-of-range per AC-39), name + notes fields. Save calls `useUpdateSkillEvalCase`/`useCreateSkillEvalCase`(existing, extended for the new shape) and surfaces the server's AC-2/AC-3/AC-39 validation errors inline on failure without closing.
3. All user-facing strings via `useTranslations("skills")` with new keys under `evals.*` — no hardcoded English text anywhere in the new/rewritten components.
4. Keep each component under ~200 lines.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] `EvalsTab.test.tsx` (new, RTL + Vitest, hooks mocked per the `OnboardingTourView.test.tsx`/agent-eval `EvalsTab.test.tsx` precedent of mocking the feature's own hooks module) covers: empty state renders both CTAs, case list renders all 5 status states with visually distinct failed_grounding vs failed_judge indicators, "Run all evals" triggers the mutation with the selected host agent id, delete requires confirmation, threshold out-of-range shows an inline error and does not close the editor
- [ ] No hardcoded English string in any new `.tsx` file — grep for literal text nodes outside `t(...)` calls

**Commit:** `feat(client): rewrite skill Evals tab (metrics, case list, editor, batch history)`

---

### Step 9: Host-agent selector — `HostAgentSelect`

**Dependencies:** none (only depends on the ALREADY-EXISTING `GET /agents` route and `useAgents()` hook — zero new server work)
**Owned paths:** `client/src/app/skills/_components/SkillDetail/_components/EvalsTab/_components/HostAgentSelect/HostAgentSelect.tsx` (new)

**What to do:**
1. A small presentational component: `useAgents()` (existing hook — confirm exact name/location in `client/src/lib/hooks/agents.ts`) to list every agent in the workspace, rendered as a `SelectInput` (the vendored primitive, NOT wrapped in a `<label>` — per the documented `client/insights.md` 2026-07-06 Mistake entry on `SelectInput` self-selecting `option[0]` when wrapped in a raw `<label>`; use a `<div>` + `<span>` caption instead).
2. Default selection logic (AC-11): on mount, if no host agent is yet selected, default to the agent named exactly `"General Reviewer"` if present in the list (case-sensitive exact match against the seeded demo agent's name — confirmed live in `server/src/db/seed.ts:317` as the first-listed built-in reviewer and already used as the L06 agent-eval seed's demo host); if absent (e.g. a workspace where the demo seed never ran or the agent was renamed/deleted), fall back to the FIRST agent in the list ordered by `created_at` (matching `useAgents()`'s existing default sort, if any — confirm at implementation time); if the workspace has ZERO agents at all, render a disabled selector with an explicit "no agents available — create one first" message and keep "Run all evals" disabled (this is the spec's "require explicit selection if none" edge case — there is nothing to default to).
3. Props: `value: string | null`, `onChange: (agentId: string) => void` — fully controlled, no internal fetch-and-select-itself state beyond the one-time default-application effect described above.

**Verify:**
- [ ] Compiles (`cd client && pnpm typecheck`)
- [ ] `HostAgentSelect.test.tsx` covers: defaults to "General Reviewer" when present, falls back to the first agent when absent, renders a disabled/empty state when the workspace has zero agents, calls `onChange` on manual re-selection
- [ ] Not wrapped in a `<label>` — confirmed by the regression test asserting a single click actually opens the option list rather than immediately self-selecting `option[0]`

**Commit:** `feat(client): add HostAgentSelect (defaults to General Reviewer, falls back to first agent)`

---

### Step 10: Seed data — ≥5 hand-authored demo skill-eval cases

**Dependencies:** Step 1 (schema — not strictly required for the seed script's own writes since it uses the EXISTING `eval_cases` table with no new columns, but the skill-eval module should exist for the seeded data to be reachable through the API for manual verification), Step 6 (module registered)
**Owned paths:** `server/src/db/seed.ts` (edit — new section appended, following the file's existing per-feature section convention)

**What to do:**
1. **Seed-target selection is the implementer's own call**, made from BOTH agents' already-seeded skills, not restricted to one agent's set. Candidates confirmed live in `seed.ts`:
   - Test Quality Reviewer's skills (`seed.ts:358-467`): `test-coverage-rubric`, `no-mock-overuse`, `boundary-cases`, `flaky-test-detector`, `backend-api-conventions`.
   - General Reviewer's skill set (confirm the exact skill list attached to `General Reviewer` at `seed.ts` — search for the agent's own skill-attachment block near `seed.ts:317` before choosing; do not assume it mirrors TQR's set).
   - Selection criterion (per the coordinator's explicit direction): pick whichever skill has the MOST NATURAL fit for clear, checkable `grounding[]` substrings (concrete keyword-bearing antipattern names, e.g. "Hardcoded Date.now()", "Math.random()", "setTimeout/setInterval" for `flaky-test-detector`, or "mocking the system under test" for `no-mock-overuse`) AND judge-able `practices[]` (a practice statement the LLM judge can verify against real review output with a verbatim quote). `flaky-test-detector` and `no-mock-overuse` are both strong candidates already scanned in this plan's own research — the implementer picks ONE (or splits ≥5 cases across two closely-related skills from the SAME agent if that produces a more illustrative demo, as long as the ≥5 bar is met for at least one single skill per AC-37's literal requirement — re-read AC-37 at implementation time to confirm the bar is per-skill, not spread across two).
   - Write an explicit code comment in `seed.ts` at the top of this new section recording WHICH skill(s) were chosen and WHY (the specific grounding-substring/practices-judgeability reasoning), so a future reader does not have to re-derive this decision — this is a deliberate implementer judgment call flagged for visibility, not an arbitrary default.
2. Design the 5 cases to exercise the scoring edge cases deliberately (mirrors the already-proven agent-eval seed's deliberate-coverage approach):
   - 2+ cases with both `practices[]` and `grounding[]` populated (the common case — full two-tier scoring).
   - 1 case with `grounding[]` only, empty `practices[]` (exercises the "grounding alone determines pass/fail, no judge call, cost has no judge component" path — AC-22/AC-24/AC-27 edge case).
   - 1 case with `practices[]` only, empty `grounding[]` (exercises the "no grounding requirement, judge runs on practices alone" path — AC-20/AC-22 edge case).
   - 1 case deliberately designed to FAIL the grounding gate against the chosen skill's realistic output (demonstrates the failed_grounding status distinct from failed_judge, AC-21/AC-30).
   - Each case's `fixture` is a small, valid unified diff — reuse or closely follow the SAME hand-tracing discipline already documented in `server/insights.md`'s 2026-07-06 entry on `parseUnifiedDiff`'s new-side line-numbering rule IF any case's grounding/practices reference specific diff line content (this feature's `grounding[]` is a substring check against review OUTPUT TEXT, not diff line ranges, so the line-numbering pitfall does not directly recur here — but every fixture must still parse successfully via `parseUnifiedDiff`, since the orchestrator calls it per case exactly like the agent-eval orchestrator does).
3. Each case gets a fixed, deterministic UUID literal (hardcoded, following the existing `'11111111-1111-4111-a111-00000000000N'`-style convention already used by the agent-eval seed section) and the insert uses `.onConflictDoNothing()` keyed on that literal id — re-running `pnpm db:seed` must not duplicate rows (AC-38).
4. Insert via `ownerKind: 'skill'`, `ownerId: <chosen skill's id>` (resolved the same way the existing seed resolves `generalReviewer`/`tqrAgent` — a `SELECT ... WHERE workspace_id = $1 AND name = $2` lookup before the insert block, guarded with `if (chosenSkill) { ... }` so the section no-ops gracefully if the skill lookup somehow fails on a partial/customized seed run).
5. `expected_output: { practices: [...], grounding: [...], threshold: 0.6 }` (or a case-specific non-default threshold if illustrative) — this is the NEW skill-eval JSON shape, NOT the agent-eval `Expectation[]` shape; both shapes coexist in the same `eval_cases.expected_output` JSONB column, discriminated at read time by `owner_kind`, never mixed.

**Verify:**
- [ ] `cd server && pnpm db:seed` runs without error on a fresh DB
- [ ] Running `pnpm db:seed` a second time does not duplicate the 5+ rows (`SELECT COUNT(*) FROM eval_cases WHERE owner_kind='skill' AND owner_id = '<chosen-skill-id>'` stays constant after 2 runs)
- [ ] Each seeded case's `fixture`/`input_diff` parses successfully via `parseUnifiedDiff` (spot-check manually or via a quick throwaway assertion, not committed)
- [ ] `docker exec devdigest-postgres psql -U devdigest -d devdigest -c "SELECT name, owner_id, expected_output FROM eval_cases WHERE owner_kind='skill'"` shows the ≥5 expected rows with sensible practices/grounding/threshold

**Commit:** `feat(seed): add demo skill-eval cases for <chosen-skill-name> (idempotent)`

---

### Step 11: Server hermetic test sweep + operational restart note

**Dependencies:** Step 6 (all server code must exist)
**Owned paths:** none new — this step runs the FULL hermetic suite and reports results; it may touch existing test files ONLY to fix a regression it caused, never to add new coverage (new coverage belongs in Steps 3/4/5/6's own test files)

**What to do:**
1. Run `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — the full hermetic suite, not just this feature's new test files, to catch any cross-module regression (e.g. a barrel-export collision from Step 2, or an accidental `eval_runs` column-order assumption broken by Step 1's `ALTER TABLE`).
2. If any PRE-EXISTING test fails because of this feature's changes (not a pre-existing flake — cross-check against `server/insights.md`'s documented Windows-specific pre-existing failures, e.g. the `indexer-pipeline.test.ts`/`conventions-extractor.test.ts` ENOENT entries, which are known-excluded on this machine and NOT this feature's responsibility), fix the regression in this step.
3. Report, as an explicit operational note (do not execute): the user's own `:3001` process must be restarted to pick up the new migration + module registration before manually smoke-testing the new routes or the client's new Evals tab against a live backend. Do not start or restart any server yourself.

**Verify:**
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — 100% pass (excluding the documented pre-existing Windows-specific exclusions)
- [ ] `cd client && pnpm test` — 100% pass
- [ ] No new `pnpm typecheck` errors in either package

**Commit:** (only if a regression fix was needed) `fix(skills): resolve test regression from skill-eval pipeline addition` — otherwise this step produces no commit, only a verification report.

---

## 6. Acceptance Criteria

- [ ] AC-1: Every case/run/scoring operation scoped to `owner_kind='skill' AND owner_id=<this skill>` — Step 4, Step 5.
- [ ] AC-2: Case save requires non-empty `practices` OR non-empty `grounding` — Step 5 (`createCaseManual`/`updateCase`).
- [ ] AC-3: Empty fixture blocked with inline validation error, not saved — Step 5, Step 8 (Case Editor surfaces it).
- [ ] AC-4: "Promote to skill eval case" requires explicit skill selection, never inferred — Step 5 (`createCaseFromFinding` takes `skillId` as an explicit param), Step 6 (route body carries `skill_id`).
- [ ] AC-5: Case fixture = the finding's OWN file's diff hunk(s), not the whole PR diff — Step 5 (reuses the agent-eval's exact file-scoped extraction).
- [ ] AC-6: Accepted-finding case defaults to a positive practice + grounding key terms — Step 5.
- [ ] AC-7: Dismissed-finding case defaults to a negative practice, judged (not grounding-gated) — Step 5.
- [ ] AC-8: Case provenance records finding-origin (id + PR number) or manual — Step 2 (contract), Step 5 (`input_meta`).
- [ ] AC-9: Delete requires explicit confirmation — Step 8 (`ConfirmModal`).
- [ ] AC-10: Threshold defaults to 0.6 when unset — Step 2 (contract default), Step 5.
- [ ] AC-11: "Run all evals" requires a host agent (default resolved client-side), creates one batch for the full case set — Step 5, Step 8, Step 9.
- [ ] AC-12: Per-row single-case run uses the same mechanism, scoped to one case — Step 5, Step 8.
- [ ] AC-13: Every case run = host agent's own config + skill-under-test appended to its existing linked skills (marginal contribution, never isolation) — Step 5 (`startBatch`/`executeBatch`).
- [ ] AC-14: A strict-subset run is recorded as `kind: 'calibration'` — Step 5.
- [ ] AC-15: A per-case runtime failure is a distinct `error` status; the batch continues — Step 5.
- [ ] AC-16: Degraded-batch aggregates computed only from successfully-evaluated cases — Step 5.
- [ ] AC-17: Snapshot identity = skill body + skill version + host agent's model + host agent id (never body alone) — Step 5 (`snapshotIdentity`).
- [ ] AC-18: Run route rate-limited (2/min, per-workspace) + concurrency-capped (3) — Step 6, Step 5.
- [ ] AC-19: Run route responds 202 immediately, executes detached — Step 6.
- [ ] AC-20: Grounding passes only when every substring is present; empty/absent list = no requirement — Step 3 (`patternMatch`).
- [ ] AC-21: Grounding failure skips the judge entirely, distinct outcome — Step 3, Step 5.
- [ ] AC-22: Practices judge invoked only when grounding passed/absent AND practices non-empty; verbatim evidence required for a pass — Step 3 (`judgePractices`).
- [ ] AC-23: Case judge score = passed practices / total judged practices — Step 3.
- [ ] AC-24: Case passes iff grounding ok AND (no practices OR judge score ≥ threshold) — Step 3 (`casePassed`).
- [ ] AC-25: Batch judge score = average across cases that reached judging (excludes grounding-failed/errored) — Step 5.
- [ ] AC-26: Batch grounding pass rate = passed-or-no-requirement / successfully-run cases — Step 5.
- [ ] AC-27: Grounding = zero LLM calls; judge = exactly one LLM call per judged case — Step 3 (tested explicitly).
- [ ] AC-28: Evals tab shows every case joined with its most recent outcome — Step 5 (`listCases`), Step 8.
- [ ] AC-29: Never-run case shows a distinct state, no pass/fail summary — Step 8.
- [ ] AC-30: 5 distinct visual outcome states (never_run/passed/failed_grounding/failed_judge/error) — Step 8.
- [ ] AC-31: Metrics strip shows latest batch's judge score / grounding pass rate / cases-passing / cost — Step 8 (`SkillEvalMetrics`).
- [ ] AC-32: Batch history persists timestamp, snapshot identity, host agent id, aggregates, cost, status — Step 1 (schema), Step 5.
- [ ] AC-33: Cost attributable per case and aggregable per batch — Step 5.
- [ ] AC-34: Batch cost ≤ $0.15 on the seeded reference set with cheap default models — Step 10 (seed sizing), verified manually post-implementation.
- [ ] AC-35: Every skill-eval query workspace-scoped — Step 4.
- [ ] AC-36: Uniform across every skill; each has its own isolated case set/batches/history — Step 4, Step 5.
- [ ] AC-37: ≥5 seeded cases for at least one skill — Step 10.
- [ ] AC-38: Seed is idempotent (no duplication on re-run) — Step 10.
- [ ] AC-39: Per-case editable threshold (0–1), persisted, applied at run time, rejected inline if out of range — Step 2 (contract), Step 5, Step 8.

## 7. Testing Plan

**Server:** hermetic (`.test.ts` with `MockLLMProvider`/fake db from `src/adapters/mocks.ts`) for all new logic — no integration (`.it.test.ts`) test is required by this plan since no new Testcontainers-dependent cross-service behavior is introduced beyond what the existing agent-eval `.it.test.ts` suite already proves for the shared `eval_cases`/`eval_runs` infrastructure pattern; if the implementer judges a real-DB integration test valuable for the new `skill_eval_batches` table specifically, it may be added as an extra, but it is not required to meet this plan's Acceptance Criteria.

**Client:** Vitest + RTL, hooks mocked — no running server needed.

| Test | Type | Covers |
|---|---|---|
| `skill-eval-scoring.test.ts` | hermetic | AC-20, AC-21, AC-22, AC-23, AC-24, AC-27 |
| `skill-eval-repository.test.ts` | hermetic | AC-1, AC-35, AC-36 |
| `skill-eval-service.test.ts` | hermetic | AC-4–AC-8, AC-11–AC-17, AC-25, AC-26 |
| `skill-eval-routes.test.ts` | hermetic | AC-18, AC-19, AC-35 (404 cross-workspace) |
| `EvalsTab.test.tsx` | RTL | AC-9, AC-28, AC-29, AC-30, AC-31 |
| `SkillCaseEditor.test.tsx` (may be folded into `EvalsTab.test.tsx` or split out) | RTL | AC-2, AC-3, AC-39 |
| `HostAgentSelect.test.tsx` | RTL | AC-11 (default resolution + fallback + empty state) |

**Verification scripts & CI parity:**

- `pnpm verify:skill-eval` — added to `server/package.json`, mirrors `verify:l06`: `pnpm typecheck && pnpm exec vitest run test/skill-eval-scoring.test.ts test/skill-eval-repository.test.ts test/skill-eval-service.test.ts test/skill-eval-routes.test.ts`. **Inert until Steps 3–6 create those four files**; Step 11 must confirm it exits 0. (Note: `server/package.json` is normally tracked — flag `H`, not skip-worktree — so this script IS committed.)
- **Final verification — run at the very end, after every step:**
  1. `cd server && pnpm verify:l06` — **regression gate**: the agent-eval pipeline must stay green (this feature must not break it).
  2. `cd server && pnpm verify:skill-eval` — the new gate is green.
  3. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — full server hermetic sweep (Step 11).
  4. `cd client && pnpm typecheck && pnpm test` — client suite (mirrors the `client / tests` GitHub check).
- **GitHub checks that fire for THIS feature's PR** (by path filter — confirm all green before merge):
  - `server unit / typecheck` + `server unit / tests` — triggered by `server/**`; runs the full hermetic sweep (includes the new `skill-eval-*.test.ts`). CI does NOT call `verify:*` — it runs the whole sweep, so the new tests are covered regardless.
  - `client / tests` — triggered by `client/**`; runs `pnpm typecheck && pnpm test` (includes the new client RTL tests).
  - `server integration` — triggered by `server/**`; runs `.it.test.ts` (this feature adds none by design — the existing suite must still pass).
  - `evals / model evals (OpenRouter)` — **does NOT trigger for this feature.** Its path filter is `.claude/**` / `CLAUDE.md` / `evals/**` only; this feature touches `server/**`/`client/**`/`docs/**`. That workflow evals the repo's OWN skills/agents (harness), orthogonal to the in-app Skill Evals tab — it fires only if a step also edits a `.claude/` skill/agent or the `evals/` package (none planned).

## 8. Out of Scope

- Trend chart UI for a skill's batches over time (spec Non-goal — deferred).
- Batch Compare UI for skills (spec Non-goal — deferred).
- A KPI-delta strip for skills (spec Non-goal — deferred).
- The two-panel, source-aware Case Editor redesign (spec Non-goal — the simpler existing pattern is reused).
- Cloning an agent-owned case into a skill-owned case or vice versa (spec Non-goal).
- An "isolated" run mode (host agent stripped to only the skill under test) — marginal-contribution only, per spec.
- A standalone model picker for skill-eval runs — the model is whatever the selected host agent is configured with.
- Recall/precision/citation-accuracy scoring for skill cases (that methodology stays agent-eval-only).
- Any change to `owner_kind='agent'` eval capability — the existing agent-eval pipeline (`server/src/modules/eval/`) is completely untouched by this plan.
- Exposing skill-eval as an MCP tool.
- A workspace-wide dashboard aggregating every skill's evals.
- Flaked-status detection (present in the agent-eval pipeline, NOT requested by any of this spec's 39 AC — confirmed absent).
