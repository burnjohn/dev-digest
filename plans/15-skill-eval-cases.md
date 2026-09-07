# Skill-owned eval cases — Implementation Plan

## Source requirements

Implements [`specs/15-skill-eval-cases.md`](../specs/15-skill-eval-cases.md)
(SPEC-15, status: approved) in full — **AC-1 … AC-55**. SPEC-15 resolves
[`specs/12-eval-pipeline.md`](../specs/12-eval-pipeline.md)'s **N3** and is
strictly additive to it; every SPEC-12 decision it names by number
(D1, D4, D8/D9, D16, D17, D18, D19) is inherited unchanged and is implemented
here by extending the shipped `server/src/modules/eval/*`, never by forking it.

Locked by user sign-off in SPEC-15 §*Resolved decisions (post-draft)* and
**not re-opened by this plan**: the two-armed ablation model (D3/1), exactly
two case-creation paths with no adopt-from-agent flow (2), no per-skill detail
page (3), and a 4-case demo minimum (4).

Nothing in this plan reads from, writes to, or depends on the repository-root
`evals/` directory or `.claude/skills/` — see SPEC-15's disambiguation note
(spec lines 14-25). A "skill" below always means a `skills` table row.

## Clarifications & recommendations

### Answered before planning (user-confirmed)

1. **Execution mode** — multi-agent, as recommended. See *Execution mode*.
2. **The `source_finding_id` unique index is wrong for skill cases**
   (planner finding, approved as proposed). `eval_cases_source_finding_uq`
   is unique on `source_finding_id` **alone**
   (`server/src/db/schema/eval.ts:57`). But AC-1 scopes idempotency to the
   finding *and* the skill, and SPEC-15's edge case *"The same finding turned
   into cases for three different injected skills"* (spec lines 706-708)
   requires several rows per finding. Worse, SPEC-12 already writes an
   **agent**-owned case from a triaged finding, so the first skill case
   created from an already-used finding would raise `23505`, fall into
   `getCaseBySourceFinding`'s race path (`eval/service.ts:242-245`) and hand
   back **the agent's case**. → Migrate to a composite unique index on
   `(source_finding_id, owner_kind, owner_id)` and make the idempotency read
   owner-scoped. §2 / §3.
3. **Spec clarification #5 — persist both arms' full finding sets? Yes**
   (approved as proposed). Sizing: `EvalActualFinding`
   (`vendor/shared/contracts/knowledge.ts`, the `// ---- Eval ----` region)
   carries file / line range / severity / category / title / `matched` and
   **no rationale, suggestion or code**, so one outcome is ≈1–1.5 KB of JSON;
   a 4-case run ≈8–12 KB, a 20-case run ≈60 KB, TOASTed out of the main
   heap by Postgres. `eval_runs.per_case` already stores exactly this for one
   arm (`schema/eval.ts:84`). Privacy: the without-arm introduces **no new
   class** of stored data — only volume — and SPEC-15 §*Privacy of logs*
   constrains *logging*, which is unaffected (§6). Storage/privacy cost is
   therefore not a reason to store aggregates only, and AC-36's side-by-side
   view needs the full sets. → Persist both.

### Planner recommendations (judgment calls — flagged, not requirements)

- **R1 — Four new columns, not ten; lift and per-case effect are derived.**
  Keep `per_case` / `recall` / `precision` / `citation_accuracy` /
  `cost_usd` / `duration_ms` meaning the **with-arm**, so every shipped
  surface (`runRowToEvalRun` `service.ts:78-90`, `metricsOverCaseIds`
  `:128-131`, `buildCallout` `callout.ts:22`, `MetricTiles.tsx`,
  `RecentRunsTable.tsx`) renders a skill run unchanged — that is AC-18 and
  AC-42 held by construction rather than by re-testing. Add exactly
  `arm_without jsonb` (the existing `EvalRun` shape reused verbatim, which
  already nests `per_case`), `skill_version`, `carrier_agent_id`,
  `gates_bypassed`; reuse the existing `agent_version` column for the
  **carrier's** config version, which is literally what its comment already
  says it is (`schema/eval.ts:76-77`).
  *Lift and the four-value effect classification are computed by pure
  functions in `scoring.ts` and materialised into the response DTO, not
  stored as further columns.* This is a mild reading of AC-24's "shall store
  … the per-metric lift, the per-case effects" — read as *the run record
  carries them*. Rationale: both are total functions of two stored arms, and
  a third persisted copy can drift from the arms it claims to summarise.
  **If a verifier reads AC-24 literally, the remedy is additive** (three
  `lift_*` doubles + a `per_case_effect jsonb`) and changes no logic.
- **R2 — Seed fixture: `secret-leakage-gate` carried by `Security Reviewer`.**
  SPEC-15 clarification #4 left this to planning. The link already exists
  (`server/src/db/seed-skills.ts:281`), and the seeded fixture PR #491 plants
  `SESSION_SECRET = 'sk_live_51HxampleNotARealKeyDoNotUse00'`
  (`seed-eval-cases.ts:47`) — a literal the skill body names by prefix
  (`seed-skills.ts:80`). AC-31's demonstration is then exactly "delete the
  `sk_live_` bullet, re-run, watch recall lift fall". §9.
- **R3 — Separate routes and a separate compare contract, never a widened
  agent one.** AC-42 says existing agent responses behave *exactly* as
  before; adding even a null-valued key to `EvalCompare` widens that shape.
  New `EvalSkillCompare` + `GET /eval/skills/compare`, and a new
  `POST /findings/:id/skill-eval-case` rather than an optional `skill_id` on
  the existing `POST /findings/:id/eval-case`.
- **R4 — `STALE_RUN_TIMEOUT_MS` stays 15 minutes** (`eval/constants.ts:28`),
  as AC-15 says "the product's existing staleness timeout". Its own comment
  reasons about a *single-arm* suite; a skill run is 2×N executions. Safe for
  the 4-case demo (8 executions). Add a comment recording the halved
  headroom rather than changing a constant an agent run also depends on.
- **R5 — Run-all-skills (AC-26) auto-selects a carrier deterministically**:
  per skill, the linked agent with the lowest `agent_skills.order`, ties
  broken by agent name. D11 requires the carrier be recorded on the run
  (it is, §2) and D6/AC-52 require it be displayed; the confirmation modal
  must state that carriers were auto-selected as well as the total execution
  count. A skill with zero linked agents is skipped with a stated reason,
  reusing `runAll`'s existing per-owner `refused_reason` shape
  (`service.ts:500-513`).
- **R6 — Verify, do not assume, that reviewer-core's `INJECTION_GUARD` wraps
  the `skills` prompt slot** and not only the diff, before claiming AC-50.
  `server/CLAUDE.md` §Gotchas states the guard is one shared block in
  `reviewer-core/prompt.ts` and forbids adding ad-hoc denylist logic here —
  so if the slot is outside the guard, the fix belongs in `reviewer-core`
  and is **out of this plan's scope**: report it, do not patch it locally.

### Open item this plan could not close

- **Spec clarification #7 (accepted-conventions gap-check) is still
  unperformed.** `mcp__devdigest__get_conventions` and the blast-radius /
  findings MCP tools were unreachable again at planning time: the API is down
  (`localhost:3001` → connection refused) and the Docker daemon is not
  running (`:5432` closed), so the `conventions` table cannot be read either.
  Substituted a written-conventions pass (both `CLAUDE.md`s, both
  `LEARNINGS.md`s, `pr-self-review` Phase 3) — **no conflict found**; the
  three real landmines it surfaced are in *Architectural constraints*.
  **Implementer action:** if `./scripts/dev.sh` is up when you start, run
  `mcp__devdigest__get_conventions` once and report any accepted convention
  this plan contradicts before writing code. If the stack is down, record
  that and proceed — this is explicitly not a blocker.

## Execution mode

**Recommended: multi-agent.** Cross-module (server + client), adds a
migration that *alters an existing unique index* on a table with live rows,
touches `server/src` layering, and rests on an invariant (AC-16, byte-identical
arms) that is worse than useless if silently broken — SPEC-15
§*Non-functional* calls attribution validity the feature's primary quality
attribute.

**User-confirmed, and the order to run:**

1. `implementer` — **server slice** (§1 contracts, §2 schema/migration,
   §3–§8 module + wiring, §9 seed)
2. `implementer` — **client slice** (§10–§14)
3. `plan-verifier` — gate against the AC list
4. `architecture-reviewer` — onion rings, `no-cross-module`, DI wiring
5. `test-writer` — the two-arm scoring suite AC-55 requires, invoked
   separately

The server slice must land and typecheck before the client slice starts: the
client consumes contracts §1 defines.

## Modules affected

| Module | Why |
|---|---|
| `server` | The whole feature's logic: `owner_kind='skill'` routes, two-arm executor and scorer, run identity columns + migration, cascade on skill delete, seed fixtures. |
| `client` | Fills the reserved Skill-editor Evals tab and the reserved "Run on evals" button; adds the dashboard's skills section; hooks; i18n. |
| `reviewer-core` | **Unchanged** — consumer-only, inherits SPEC-12 D6. If R6 finds the guard gap, report it; do not edit it here. |
| `e2e`, `mcp-server`, `agent-runner` | **Untouched** — SPEC-15 N6/N7. |

Both `vendor/shared` copies are edited (§1) — that is a cross-cutting edit,
not a third module.

## Architectural constraints

Cited, not recalled. Read each source before touching the files it governs.

**Root `CLAUDE.md`**
- §Conventions — `server/src/vendor/shared` and `client/src/vendor/shared`
  are independent copies with no sync script; editing a shared contract means
  editing both and reconciling by hand (AC-54).
- §Conventions — migrations are **not** applied on boot: `cd server && pnpm
  db:migrate` after §2, or every eval route 500s with `relation … does not
  exist`.

**`server/CLAUDE.md`**
- §Non-default conventions — routes are schema-first: zod `params`/`body`/
  `querystring` via `fastify-type-provider-zod`; handlers never hand-roll
  `Schema.parse(req.body)`.
- §Non-default conventions — adapters sit behind `platform/container.ts` DI;
  tests swap `src/adapters/mocks.ts`, never module-level mocks.
- §Do-not-touch — never hand-edit an applied migration; add a new one.
- §Gotchas — the grounding gate lives in `reviewer-core`; prompt-injection
  defence is the one shared `INJECTION_GUARD`, never local keyword scanning
  (see R6).
- §Testing — `*.it.test.ts` = DB-backed testcontainers, self-skipping without
  Docker; everything else hermetic.

**`server/LEARNINGS.md`** (the three landmines the gap-check surfaced)
- 2026-08-03 §*"two independent enabled-gates, not one"* (line 654) — the
  two gates are deliberately independent columns and
  `AgentsRepository.enabledSkills` ANDs both in one query
  (`modules/agents/repository.ts:230-249`). D8 requires the with-arm to
  **bypass both**, so the arm builder must not reach for `enabledSkills`
  alone; it must read the skill row directly and splice it in (§5). Do not
  "fix" the gates into one flag while here.
- 2026-08-03 §*"a new module needing another module's repo/service must use
  the `AgentLookup`-style local port"* (line 218) — `pnpm arch` fails on any
  direct cross-module import. But note the counterpart already recorded in
  `modules/eval/ports.ts:4-14`: `eval/repository.ts` **is** permitted to read
  `src/db/**` directly, which is why §3 extends the repository rather than
  adding ports.
- 2026-08-03 §*"`.dependency-cruiser-known-violations.json` baselines exact
  from→to edges"* (line 863) — if `pnpm arch` fails on a new edge, regenerate
  with `pnpm arch:baseline` and **diff the file** to confirm it added only the
  expected edge.
- 2026-08-03 §*"findings attribution from `run_skills` is RUN-level"*
  (line 780) — the motivation for this whole feature. AC-46: where this
  feature displays Stats-tab figures beside its own, their existing
  over-count caption stays.
- 2026-08-19 §*"a bare `pr_files.patch` becomes a parseable unified diff by
  prepending three lines"* (line 469) — reuse
  `frozen-input.ts`'s `synthesizeFrozenDiff`; never re-derive the header.
- 2026-08-11 §*"`ConfigError` responds HTTP 500, not a 4xx"* (line 158) —
  §6 must keep SPEC-12's translation of `ConfigError` into a stated 422
  (`service.ts:350-362`) on the skill path too (AC-49).
- 2026-08-21 §*"parallel git worktrees share ONE Postgres"* (line 58) —
  relevant if working in a worktree while generating §2's migration.

**`client/CLAUDE.md`**
- §Non-default conventions — all data access goes through `src/lib/hooks/*`
  → `src/lib/api.ts`; never `fetch` in a component.
- §Non-default conventions — pages stay thin, feature logic in colocated
  `_components/<Name>/` folders each with its own `*.test.tsx`.
- §Non-default conventions — new UI strings go in `messages/<locale>/*.json`,
  never inline literals.
- §Do-not-touch — `src/vendor/ui` is owned source with no resync mechanism.

**`client/LEARNINGS.md`**
- 2026-08-13 §*"`Markdown.tsx` sets no `urlTransform` and no `img` override"*
  (line 301) — it blocks raw HTML but **not** link/image targets. AC-51's
  skill-body diff must therefore render as plain `<pre>` lines, exactly like
  `CompareModal.tsx:54-60` already does for `prompt_diff`, **not** through
  `Markdown`.
- 2026-08-21 §*"additively widening a shared primitive"* (line 507) — new
  props optional, gated on presence, old call sites unchanged. The shape §11
  uses for `CaseEditorPanel`'s second arm.
- 2026-08-19 §*"`api.ts`'s `post`/`patch` discard the HTTP status"*
  (line 718) — the idempotent-create path needs `api.postWithStatus`, as
  `useCreateEvalCaseFromFinding` already does (`lib/hooks/eval.ts:65`).
- 2026-08-21 §*"a dynamic-route path segment is a glob character class to
  vitest's CLI filter"* (line 321) — affects the *Verification* commands;
  quote and verify a non-zero file count.
- 2026-08-04 §*"a component under test that calls `useToast()` … `vi.spyOn`
  it"* (line 580) and 2026-08-03 §*"a component that unconditionally calls
  two mutation hooks"* (line 594) — both apply to the new tab's tests.

## Approach

### §1 — Contracts, in **both** `vendor/shared` copies (AC-54)

Edit `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` and apply the
identical edit to `client/src/vendor/shared/contracts/`. `eval-ci.ts` is
currently byte-identical outside three known drift hunks and `knowledge.ts`'s
`// ---- Eval ----` region is byte-identical — both facts are asserted by
`server/test/eval-contract-parity.test.ts`, which must keep passing with **no
new normalisation hunk added** (AC-54's "shall not increase the existing
divergence").

In `knowledge.ts`, inside the existing `// ---- Eval ----` … `// ---- Memory ----`
region (base vocabulary):
- `EvalCaseEffect = z.enum(['helped','hurt','no_effect_pass','no_effect_fail'])` (D5/AC-20)
- `EvalSkillCaseEffect = z.object({ case_id, name, effect: EvalCaseEffect })`
- Update `EvalExpectationType`'s comment at `knowledge.ts:~203`, which
  currently says *"Only 'agent'-owned cases are ever written this slice (N3);
  'skill' stays reserved"* — now stale.

In `eval-ci.ts` (API envelopes):
- `EvalLift = z.object({ recall, precision, citation_accuracy })`, all
  `z.number().nullable()` (AC-22 — a lift over a null arm is *not applicable*,
  never 0).
- `EvalSkillRunRecord = EvalRunRecord.extend({ skill_version, carrier_agent_id,
  carrier_agent_name, gates_bypassed, arm_without: EvalRun.nullable(),
  lift: EvalLift.nullable(), effects: z.array(EvalSkillCaseEffect),
  effect_counts: z.object({ helped, hurt, no_effect_pass, no_effect_fail }) })`
  — an **extension**, so a skill run is still an `EvalRunRecord` everywhere
  (AC-18).
- `EvalSkillCarrier = z.object({ agent_id, agent_name, skill_enabled,
  link_enabled })` — the AC-11 picker's option, carrying both gate states so
  the surface can state the bypass (AC-52) without a second call.
- `EvalSkillRunInput = z.object({ carrier_agent_id: z.string().uuid() })`.
- `EvalSkillRunEstimate = z.object({ cases_total, executions_total,
  carrier_agent_id, carrier_agent_name, gates_bypassed })` — `executions_total`
  is `2 × cases_total` (AC-25).
- `EvalSkillOffer = z.object({ skill_id, skill_name, has_case })` — AC-2's
  offer list for a finding.
- `EvalSkillSummary = z.object({ skill_id, skill_name, cases_total,
  carrier_agent_name, latest: EvalSkillRunRecord.nullable(), tokens_per_run })`
  — AC-39's dashboard row.
- `EvalDashboard` gains `skills: z.array(EvalSkillSummary)` — purely additive;
  `agents` and `recent_runs` keep their exact current shapes (AC-42).
- `EvalSkillCompare` — its own contract (R3): `old`/`new` as
  `EvalSkillRunRecord`, `common_case_ids`, `only_in_old`, `only_in_new`,
  `carrier_differs: z.boolean()`, `deltas` (metrics), `lift_deltas`, and
  `skill_body_diff` reusing `EvalCompare.prompt_diff`'s
  `{kind, text}[]` line shape (AC-33).

Hand-authored case creation (AC-8) reuses the existing `EvalCaseInput` —
no new contract.

Load the `zod` skill before this section.

### §2 — Schema + migration (`server/src/db/schema/eval.ts`)

One new migration via `pnpm db:generate` — never an edit to an applied one.

On `eval_cases`:
- Replace `sourceFindingUq` with a composite unique index on
  `(source_finding_id, owner_kind, owner_id)`. Postgres still lets many NULLs
  through, so the seven seeded fixture cases (`source_finding_id: null`,
  `seed.ts:396`) are unaffected. Keep the existing name or rename in one
  drop+create — whichever `drizzle-kit` produces cleanly.

On `eval_runs`, four nullable additions (R1), all `null` for every existing
and future agent-owned run:
- `skillVersion: integer('skill_version')` — D6, the `skills.version` this run
  injected.
- `carrierAgentId: uuid('carrier_agent_id')` — D2/D6/D11. Deliberately no FK,
  matching `ownerId`'s existing polymorphic posture (`schema/eval.ts:32`);
  cascade is application-side (§8).
- `gatesBypassed: boolean('gates_bypassed').notNull().default(false)` — AC-52.
- `armWithout: jsonb('arm_without').$type<EvalRun>()` — the without-arm's
  whole `EvalRun` object, `per_case` included.

`agentVersion` keeps its meaning verbatim ("the agent configuration version
this run executed against") and holds the **carrier's** version on a skill
run — no new column, no comment contradiction. Extend the column comment to
say so.

Heed `drizzle-kit generate`'s known hang under non-TTY stdin on a
rename ambiguity (`server/LEARNINGS.md`, 2026-08-03, line 72) — run it in a
real terminal. Load `drizzle-orm-patterns` and `postgresql-table-design`.

### §3 — `modules/eval/repository.ts`

Every method already takes `ownerKind` (`repository.ts:132,195,241,270,315`)
and needs **no change** for skills. Add, reading `src/db/**` directly as this
file already does and is explicitly permitted to (`ports.ts:4-14`):

- `getCaseBySourceFindingForOwner(workspaceId, findingId, ownerKind, ownerId)`
  — the owner-scoped idempotency read replacing clarification 2's bug. Keep
  the old single-arg method only if an agent caller still needs it; the
  agent path should move to the owner-scoped one too, which is
  behaviour-preserving for agents (its owner is derived from the finding's
  review either way).
- `skillForEval(workspaceId, skillId)` → `{ id, name, type, body, version,
  enabled }` from `skills`, workspace-scoped in the `WHERE` (AC-53).
- `carriersForSkill(workspaceId, skillId)` → the agents linked via
  `agent_skills`, with `agent_skills.enabled`, `agent_skills.order`,
  `skills.enabled`, plus the agent fields `AgentRecord` needs. Drives AC-11's
  picker, AC-49's "no agent linked" refusal and R5's deterministic ordering.
- `skillsInjectedForFinding(workspaceId, findingId)` → AC-2's offer list, via
  `run_skills` → `agent_runs` → `reviews.run_id` → `findings` — the identical
  join the Stats tab already performs
  (`modules/skills/repository.ts:413-429`). A review whose run predates
  `run_skills` yields an empty list, which is AC-2's correct empty state.
- `skillVersionBody(skillId, version)` → `skill_versions.body` for AC-33,
  falling back to `skills.body` when the version is the current one (the
  current body is never archived until superseded —
  `modules/skills/service.ts:195-205`).
- `runsForOwnerKind(workspaceId, 'skill')` / reuse of `listRecentRuns` for the
  dashboard's skills section.

`agentsWithCases` currently hardcodes `ownerKind = 'agent'`
(`repository.ts:344`) — parameterise it, per SPEC-15 D1.

### §4 — `modules/eval/scoring.ts` — the two-arm layer (pure, zero I/O, zero LLM)

`matches`, `scoreCase`, `errorCaseOutcome` and `scoreRun` are **unchanged**
(D4/AC-17 — the same code computes the same three metrics on each arm).
Add three pure functions, all of which must be unit-tested directly (AC-21,
AC-55):

- `pairArms(withOutcomes, withoutOutcomes): { with: EvalCaseOutcome[],
  without: EvalCaseOutcome[] }` — **AC-23's real subtlety.** `scoreRun`
  already drops `status === 'errored'` from its own arm, but it cannot know
  that a case which scored *with* the skill errored *without* it. Such a case
  is half a comparison and must be excluded from **both** arms and from every
  lift. `pairArms` therefore rewrites any case errored in either arm into
  `errorCaseOutcome(..., 'paired arm failed')` in *both* arrays before
  `scoreRun` runs, which also makes `cases_errored` the number AC-23 asks the
  run to record.
- `computeLift(withMetrics, withoutMetrics): EvalLift` — per metric,
  `with − without`; **`null` when either side is `null`** (AC-22 — a run over
  only `must_not_flag` cases reports recall *and* recall lift as not
  applicable, never 0).
- `classifyEffects(pairedWith, pairedWithout): EvalSkillCaseEffect[]` —
  D5's closed four-value classification off each case's `pass` in each arm:
  `!without && with → helped`; `without && !with → hurt`;
  `with && without → no_effect_pass`; `!with && !without → no_effect_fail`.
  Errored (hence unpaired) cases are classified **not at all** — they are
  absent from the array, never bucketed as `no_effect_fail`.

### §5 — `modules/eval/executor.ts` — arm assembly (AC-16, the load-bearing invariant)

`EvalExecutor.runCase` already takes `skillBlocks: RenderableSkill[]`
(`executor.ts:45-49`) and is otherwise deterministic given `(agent, blocks,
case)` — the task line is a constant plus the frozen title
(`executor.ts:63`), and nothing else varies. So **no signature change is
needed**: the two arms are two `runCase` calls differing only in the array.

Add one pure, separately-tested helper — `buildArms(carrierBlocks,
skillUnderTest, linkOrder)` — returning `{ withArm, withoutArm }` where:
- `withoutArm` = the carrier's blocks with this skill removed by id;
- `withArm` = `withoutArm` with this skill's rendered block spliced in at its
  `agent_skills.order` position, appended when the link is absent.

Two traps, both from `server/LEARNINGS.md` 2026-08-03 (line 654):
- **D8's gate bypass.** `AgentsRepository.enabledSkills` ANDs both gates
  (`modules/agents/repository.ts:240-246`), so a disabled skill never appears
  in `carrierBlocks`. The with-arm must splice in the body read by
  `skillForEval` (§3) regardless. Without this, a disabled skill yields two
  identical arms and a lift of exactly 0.0 that *looks like a result* — the
  failure mode SPEC-15 calls the most dangerous possible one (spec 676-681).
- **Ordering.** Both arms must keep the other blocks in identical order, so
  build `withArm` **from** `withoutArm` rather than filtering twice.

Rendering goes through `renderSkillBlock` (`modules/_shared/skill-render.ts:24`)
— the one shared renderer, exempt from `no-cross-module`, and the same one
the real run executor and the Preview tab use. A second copy of this
formatting silently decouples the measurement from what a review injects.

**D9/AC-13 stays absolute:** the arms carry only the carrier's versioned
identity + the frozen input. In particular the skill's **project-context
documents are NOT injected** — `SkillsService.preview` returns both
`block` and `project_context_block` (`modules/skills/service.ts:210-231`) and
only `block` is in scope here. `executor.ts:9-20` already lists the
deliberately-absent slots; extend that comment rather than replacing it.

Write the AC-16 test as a direct assertion on the two returned
`PromptAssembly` objects (`EvalCaseExecutionResult.assembly`,
`executor.ts:40-41`, which exists for exactly this) — they must differ only
by this skill's block.

### §6 — `modules/eval/service.ts`

Additive methods; **no existing method changes behaviour** (AC-42). The
`'agent'` literals at `service.ts:228,250,312,331,338,368` stay as they are on
the agent paths.

- `listSkillOffersForFinding(workspaceId, findingId)` → AC-2.
- `createCaseFromFindingForSkill(workspaceId, findingId, skillId)` — AC-1,
  AC-3 … AC-7. A near-copy of `createCaseFromFinding`
  (`service.ts:154-248`) with four differences: the skill must be in
  `skillsInjectedForFinding` (AC-2, else 422); the owner is
  `('skill', skillId)`; idempotency uses the owner-scoped read (§3); the
  `23505` belt-and-braces re-read is owner-scoped too. Everything else —
  the accept/dismiss → `must_find`/`must_not_flag` derivation including the
  re-triage tie-break (`:179-189`), `synthesizeFrozenDiff`,
  `MAX_FROZEN_DIFF_BYTES`, `isExpectationGrounded` — is reused verbatim
  (D9, AC-9).
- `createSkillCase(workspaceId, skillId, input: EvalCaseInput)` — AC-8's
  hand-authored path. Runs the *same* size cap and `isExpectationGrounded`
  check as `updateCase` (`:271-288`), so AC-9 and AC-10 hold identically on
  both creation paths.
- `skillEstimate(workspaceId, skillId, carrierId)` → `EvalSkillRunEstimate`
  with `executions_total = 2 × cases_total` (AC-25) and `gates_bypassed`
  from the two gate flags (AC-11/AC-52).
- `startSkillRun(workspaceId, skillId, carrierId)` — order matters and is
  itself an AC:
  1. resolve the **skill** and the **carrier** workspace-scoped, *before any
     case row is read* (AC-53's verify clause);
  2. `reconcileStaleRunning(cutoff, {ownerKind:'skill', ownerId:skillId})`
     **before** the in-flight guard (D19/AC-15, mirroring `:327-331`);
  3. `activeRunForOwner(ws,'skill',skillId)` → 409 (AC-14);
  4. cases empty → 422 `no_cases`; no linked agent → 422 (AC-49);
  5. `resolveLlm(carrier.provider)` **before** inserting the run row, with
     the `ConfigError` → 422 translation kept (`:350-362`) so no orphan run
     row is left (AC-49);
  6. insert the run with `skillVersion`, `carrierAgentId`,
     `agentVersion = carrier.version`, `gatesBypassed`, `caseIds`;
  7. return `202` with `{run_id, status, estimate}` and execute in the
     background, exactly as the agent path does (`:377-381`).
- `executeSkillRun(...)` — per case: `runCase` with `withArm`, then with
  `withoutArm`; each wrapped in its own try/catch producing
  `errorCaseOutcome` (AC-23). Then `pairArms` → `scoreRun` on each →
  `computeLift` → `classifyEffects` → `completeRun` storing the with-arm in
  the existing columns and the without-arm `EvalRun` in `arm_without`.
  **Logging (SPEC-15 §Privacy of logs):** copy `:445-459`'s field list and
  add `skillId`, `skillVersion`, `carrierAgentId`, `casesHelped`,
  `casesHurt` — counts, ids, versions, model, tokens, cost. **Never** diff
  text, skill body, expectation content or finding prose.
- `runAllSkills(workspaceId)` — R5's deterministic carrier choice, reusing
  `runAll`'s per-owner refusal shape (`:500-513`).
- `skillCompare(workspaceId, a, b)` → `EvalSkillCompare`. Reuses
  `metricsOverCaseIds` (`:128-131`) over the intersection for the metric
  deltas, computes lift deltas the same way from each run's `arm_without`,
  sets `carrier_differs` from `carrierAgentId` (AC-32's second axis), and
  builds `skill_body_diff` with the existing `diffLines`
  (`prompt-diff.ts`) over the two `skillVersionBody` reads (AC-33).
- `dashboard(workspaceId)` gains a `skills` array (AC-39) — one row per skill
  owning ≥1 case, with its latest run's lift, effect counts and carrier, plus
  `tokens_per_run` (D13). `agents` and `recent_runs` are untouched.

**AC-45/D12 is held by omission and must stay that way:** nothing in this
module writes `agent_runs` or `run_skills`, because `EvalExecutor` calls
`reviewPullRequest` directly (`executor.ts:55`). Do not add observability
writes "for symmetry" — they would corrupt the very Stats-tab numbers this
feature exists to complement (`modules/skills/repository.ts:353-475`).

There is **no per-skill detail endpoint** — SPEC-15 resolved decision 3.
Do not mirror `agentDetail` (`:624`).

### §7 — `modules/eval/routes.ts`

Schema-first, `getContext` first on every route, `RUN_RATE_LIMIT`
(`constants.ts:39`) on both run-start routes (AC-28):

```
GET    /findings/:id/eval-skills            → EvalSkillOffer[]        (AC-2)
POST   /findings/:id/skill-eval-case        body {skill_id}  201|200  (AC-1)
GET    /skills/:id/eval/cases                                         (AC-34)
POST   /skills/:id/eval/cases               body EvalCaseInput        (AC-8)
GET    /skills/:id/eval/carriers            → EvalSkillCarrier[]      (AC-11)
GET    /skills/:id/eval/estimate?carrier_agent_id=                    (AC-25)
POST   /skills/:id/eval/runs   [rateLimit]  body EvalSkillRunInput 202(AC-12)
GET    /skills/:id/eval/runs                → EvalSkillRunRecord[]
POST   /eval/skills/runs/all   [rateLimit]  body {confirm: true}      (AC-26)
GET    /eval/skills/compare?a=&b=           → EvalSkillCompare        (AC-32)
```

`GET /eval/cases/:id`, `PATCH /eval/cases/:id`, `DELETE /eval/cases/:id` and
`GET /eval/runs/:id` are already owner-agnostic (`routes.ts:46-69,93-98`) and
serve skill rows unchanged — do not duplicate them. `GET /eval/runs/:id` must
return the widened `EvalSkillRunRecord` when the row's `owner_kind` is
`'skill'`, which the `.extend()` in §1 makes type-safe.

The `confirm: z.literal(true)` body is what enforces AC-26's "no execution
until confirmation" at the contract boundary, exactly as `RunAllBody`
(`routes.ts:18`) already does. Load `fastify-best-practices` and
`onion-architecture`.

### §8 — Wiring (`platform/container.ts`, `modules/skills/*`)

- **AC-43 cascade on skill deletion.** `eval_cases.owner_id` is polymorphic
  with no FK, so nothing cascades in the DB — SPEC-12 D18's problem, second
  instance. Copy the shipped pattern exactly: `SkillsService` gains an
  optional `evalCleanup?: EvalCleanup` third constructor arg, declared
  **locally in `modules/skills/service.ts`** (never imported from
  `modules/eval/*` — `no-cross-module`), mirroring
  `modules/agents/service.ts:55-71`; `SkillsService.delete`
  (`modules/skills/service.ts:153-155`) calls
  `await this.evalCleanup?.deleteForOwner(workspaceId, 'skill', id)` **before**
  `repo.deleteById`, mirroring `agents/service.ts:88-91`. `container.evalRepo`
  satisfies it structurally (`platform/container.ts:246-248`); wire at
  `modules/skills/routes.ts`, the same composition point agents uses. Optional
  arg keeps every existing two-arg `new SkillsService(...)` in tests compiling.
- `container.evalService` (`platform/container.ts:259-267`) needs no new
  dependency: `agentsRepo` already satisfies `AgentLookup` **and**
  `SkillLookup`, and everything else §3 adds lives on `EvalRepository`.
- Run `pnpm arch` after wiring; on a new-edge failure apply
  `server/LEARNINGS.md`'s baseline procedure (line 863).

### §9 — Seed fixtures (AC-30, AC-31 — R2)

Extend `server/src/db/seed.ts`'s eval block (`:345-400`), keeping
`seed-eval-cases.ts` as the data file per its own rationale (`:13-16`).
Owner: the **`secret-leakage-gate`** skill; carrier: **`Security Reviewer`**
(already linked, `seed-skills.ts:281`). Four cases lifted from the existing
`EVAL_FIXTURE_CASES` over fixture PR #491 — 2 `must_find`
(`hardcoded-session-signing-secret`, `refresh-token-payload-logged-in-plaintext`)
and 2 `must_not_flag` (`crypto-import-is-clean`,
`rate-limiter-addition-is-clean`) — satisfying AC-30's "at least four,
at least one of each". `source_finding_id: null` and `owner_kind: 'skill'`;
same idempotent "only if none exist" guard as `:367-377`. Seed **no**
`eval_runs`, consistent with the file's existing no-fabricated-history
posture (`:349-351`) and AC-38's empty state.

### §10 — Client hooks (`client/src/lib/hooks/eval.ts`)

Extend the existing file rather than adding a second one — `evalKeys`
(`lib/hooks/eval.ts:25-34`) is already keyed by **owner id**, not owner kind,
so `useEvalCases` / `useEvalCase` / `useUpdateEvalCase` / `useDeleteEvalCase`
(`:39-106`) work for a skill owner with **no change**. Add
`useSkillEvalCases`, `useSkillEvalCarriers`, `useSkillEvalEstimate`,
`useSkillEvalRuns`, `useStartSkillEvalRun`, `useCreateSkillEvalCase`,
`useCreateSkillEvalCaseFromFinding`, `useRunAllSkillEvals`,
`useSkillEvalCompare`, plus `evalKeys.skillCarriers/skillEstimate/skillCompare`.

Reuse `useEvalRun`'s poll-only-while-running shape verbatim (`:122-129`) —
AC-29 depends on read surfaces never triggering work. The
finding→skill-case mutation must use `api.postWithStatus` to distinguish
201 from 200 (`client/LEARNINGS.md`, 2026-08-19, line 718), as
`useCreateEvalCaseFromFinding` already does (`:65`).

### §11 — The Skill editor's Evals tab (AC-34 … AC-38, AC-47, AC-48)

Replace the placeholder body at
`app/skills/_components/SkillsView/_components/SkillEditor/_components/EvalsTab/EvalsTab.tsx`
(whose own comment predicts this slice, `:1-3`) and enable the reserved
`disabled` "Run on evals" button at
`app/skills/_components/SkillsView/SkillsView.tsx:152-161`. The tab key,
icon and route wiring already exist (`SkillEditor/constants.ts:16`) — no
new top-level route, so `client/LEARNINGS.md`'s four-wirings trap (line 453)
does not apply here.

Structure mirrors the shipped agent tab
(`app/agents/[id]/_components/AgentEditor/_components/EvalsTab/*`), colocated
under the skills feature per `client/CLAUDE.md` §Non-default conventions:

- `EvalsTab.tsx` — orchestration; copy the agent tab's `activeRunId` +
  `aria-live` polling shape (`EvalsTab.tsx:42-62,101-103`) which already
  satisfies AC-48's status announcement.
- `SkillMetricTiles.tsx` — the three metrics **with** their lift, the
  helped/hurt/unaffected counts, and the skill's per-run token cost from the
  existing `GET /skills/:id/preview` (`SkillPreview.tokens`, D13/AC-34/AC-46;
  a read, no LLM call). AC-41: an all-zero lift renders as a **stated**
  no-effect sentence, never a bare `0`. AC-47: every lift carries a sign or
  word plus its colour, never colour alone.
- `CarrierPicker.tsx` + `RunSkillEvalModal.tsx` — AC-11's carrier selection,
  AC-25's "N cases → 2N executions" statement, and the unvetted-body warning
  when either gate is off, all **before** the POST.
- `CaseList.tsx` / `CaseRow.tsx` — AC-35: name, expectation type, origin
  (source finding vs hand-authored, from `source_finding_id`), the latest
  run's effect classification, and open/edit/delete.
- `NewSkillCaseModal.tsx` — AC-8's hand-authored form; a 422 from AC-9/AC-10
  is surfaced with the server's stated reason, never a generic error.
- `SkillCompareModal.tsx` — AC-32's deltas over the intersection with the
  case-set **and carrier** difference stated, and AC-33's body diff rendered
  as plain `<pre>` lines with a prefix glyph *and* colour, copying
  `CompareModal.tsx:54-60`. **Not** through `Markdown` — see the
  `client/LEARNINGS.md` 2026-08-13 constraint (AC-51).
- **AC-36's side-by-side arms.** Widen the existing `CaseEditorPanel` with an
  optional `withoutOutcome?: EvalCaseOutcome | null` prop, gated on presence
  so the agent tab's call site and `EvalsTab.test.tsx` need zero changes
  (`client/LEARNINGS.md`, 2026-08-21, line 507). Since it must now serve two
  features, promote it — with `CaseList`/`CaseRow`/`constants.ts` — to
  `client/src/components/eval-case-editor/`, the established shared location
  (`components/context-tab`, `components/diff-viewer`,
  `components/run-trace-drawer`), and re-point the agent tab's imports. Both
  arms' finding titles render as text, never markup (AC-51).
- No per-skill detail page, no trend chart — SPEC-15 resolved decision 3.
  AC-47's non-graphical-equivalent clause is satisfied because no trend graph
  is added.

Load `frontend-ui-architecture` before deciding any file's home,
`react-best-practices` for the components, `react-testing-library` for the
`*.test.tsx` beside each.

### §12 — Eval Dashboard skills section (AC-39 … AC-41)

`app/eval/_components/EvalDashboardView/EvalDashboardView.tsx` gains a
**third** section rendering `data.skills` through a new `SkillSummaryRow.tsx`,
placed after the agent list and before recent runs. AC-40: a distinct heading
plus a stated caption that a skill's numbers are computed over its own case
set inside a chosen carrier and are not a ranking — never merged into
`AgentSummaryRow`'s list, never sorted by lift. AC-52: a run with
`gates_bypassed` is marked here too, not only in the editor.
`RunAllModal.tsx` gains the skills' 2×N executions and R5's auto-carrier
statement (AC-26).

### §13 — The finding → skill case entry point (AC-1, AC-2)

`app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
already wires `useCreateEvalCaseFromFinding` (`:13,40`). Add a second action
that first reads `GET /findings/:id/eval-skills` and offers **only** the
skills that run actually injected (AC-2), with the caption SPEC-15 D10
requires: `run_skills` proves the skill was *present*, never that it *caused*
the finding. An empty offer list is a stated empty state, not a hidden
action. Mind `client/LEARNINGS.md` 2026-08-03 (line 594) — the panel now
calls two mutation hooks, which will break a test that mocks only one.

### §14 — i18n

`client/messages/en/skills.json` — the `evals` block currently reads
*"Skill evals arrive in L06 … Nothing here is wired yet"* (`:100-101`) and
`editor.runEvalsTooltip` explains the disabled button (`:167-170`). Both are
now false; rewrite them. `client/messages/en/eval.json` gains a `skill.*`
namespace for lift, effects, carrier, gate-bypass and the two-arm case view.
No inline literals (`client/CLAUDE.md` §Non-default conventions).

## Skills for implementer

From `.claude/skills/pr-self-review/SKILL.md` Phase 3's routing table and the
catalog in `.claude/skills/README.md`. Phase 3 caps a *review* at 4 skills;
that cap does not apply to implementation — load what each file needs, when
you reach it.

| Files in this plan | Skills | Why |
|---|---|---|
| `server/src/modules/eval/**`, `modules/skills/service.ts`, `platform/container.ts` | `onion-architecture`, `fastify-best-practices` | §3–§8: ring placement for the two-arm executor/scorer, routes as adapters, the local-port rule and constructor injection for §8's cascade. |
| `server/src/modules/eval/routes.ts` | `fastify-best-practices` | §7's schema-first routes, per-route `config.rateLimit`, 202/409/422 error shaping. |
| `server/src/db/schema/eval.ts`, `src/db/migrations/**`, `src/db/seed*.ts` | `drizzle-orm-patterns`, `postgresql-table-design` | §2's composite unique index change and four nullable columns; §9's seed. |
| `*/vendor/shared/contracts/{knowledge,eval-ci}.ts` | `zod` | §1's new enums/objects, `.extend()`, and nullable-vs-optional discipline for AC-22. |
| `client/src/app/skills/**`, `client/src/app/eval/**`, `client/src/components/eval-case-editor/**` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices` | §11–§13: where the promoted shared component lives, feature boundaries, `"use client"` placement, thin routes. |
| `client/**/*.test.tsx` | `react-testing-library` | The `*.test.tsx` beside each new component. |
| every `.ts`/`.tsx` in this plan | `security` | AC-50 (untrusted skill body/diff/PR metadata as data), AC-51 (sanitised rendering), AC-53 (workspace scoping on three identities). |
| — | `engineering-insights` | At the end, per root `CLAUDE.md` §Before you finish. |

**Not applicable, and deliberately not routed:** `typescript-expert`
(`reviewer-core/**` is untouched), and every skill under
`superpowers:` / `figma:` — no gap in the routing table was found for any path
this plan touches.

## Verification

Scoped to what this plan changes. `pr-self-review` re-runs the full suites
once more before push, so nothing below needs to be a blanket run — with one
exception, called out.

**Server** (`cd server`), after `pnpm db:migrate`:

```
pnpm typecheck
pnpm exec vitest run src/modules/eval/
pnpm exec vitest run test/eval-contract-parity.test.ts test/contracts.test.ts
pnpm exec vitest run test/eval.it.test.ts        # needs Docker; self-skips without
pnpm arch
```

Passing looks like: `scoring.test.ts` green **including new cases** for
`pairArms` (a case errored in one arm only is excluded from *both* and
counted once in `cases_errored` — AC-23), `computeLift` returning `null` when
either arm is `null` (AC-22), and `classifyEffects` covering all four values
plus the errored-case exclusion (AC-20); `executor.test.ts` green including
the AC-16 assertion that the two arms' `PromptAssembly` differ **only** by
this skill's block; `eval-contract-parity.test.ts` green **with no fourth
normalisation hunk added** (AC-54); `eval.it.test.ts` green including the
skill routes over their documented surface, a cross-workspace carrier refused
before any case row is read (AC-53), and the AC-45 assertion that a skill's
`GET /skills/:id/stats` payload is byte-identical before and after a
completed eval run. `pnpm arch` clean, or a baseline diff showing exactly one
expected new edge.

Then extend the mechanical command AC-55 names, and run it:

```
pnpm verify:l06     # add: src/modules/eval/executor.test.ts + the new skill it-tests
```

**Client** (`cd client`):

```
pnpm typecheck
pnpm exec vitest run "src/app/skills/**" "src/app/eval/**" "src/components/eval-case-editor/**" "src/lib/hooks/**"
pnpm exec vitest run "src/app/repos/**/FindingsPanel/**"
```

Passing looks like: the new Skill Evals tab tests green (empty-cases state
AC-37, cases-but-never-run state AC-38, all-zero-lift stated not bare AC-41,
carrier picker + 2N estimate + gate warning before any POST AC-11/AC-25);
`CompareModal.test.tsx` and the agent `EvalsTab.test.tsx` green **unchanged**,
which is what proves §11's promotion and optional-prop widening were
non-breaking (AC-42); `FindingsPanel.test.tsx` green after being taught about
the second mutation hook. Verify each glob actually matched files — a
bracketed dynamic-route segment silently matches zero
(`client/LEARNINGS.md`, 2026-08-21, line 321).

**Full-suite exception.** §1 edits shared contracts and §2 migrates a table
agent-owned eval runs also use, so a scoped run cannot catch every regression
this could cause. Before handing off to `plan-verifier`, run `pnpm test` once
in **each** of `server/` and `client/`.

**Not run here:** `evals/`'s `pnpm eval:quality` and friends. Nothing in this
plan touches `.claude/skills/**` or `.claude/agents/**`, and root `CLAUDE.md`
§Eval Self-Check routes on those paths only — SPEC-15 N12.
