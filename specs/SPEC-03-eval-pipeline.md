---
module: cross-cutting
created: 2026-07-12
---

# Spec: Eval Pipeline  |  Spec ID: SPEC-03  |  Status: approved
Supersedes: —

Authored headless (no interactive interview). The five known gaps are recorded in
**Open Questions / Decisions needed** below, each with a recommended default the spec is
written on. Anything still genuinely undecided is marked `[NEEDS CLARIFICATION]`.

## Problem & why

A reviewer agent is a prompt plus a model, and today we tune it **blind**. When someone edits
an agent's `system_prompt` (`server/src/db/schema/agents.ts:17`), there is no way to answer
"did that make the agent better or worse?" other than eyeballing a few reviews. Regressions —
the agent stops flagging a real bug, or starts flagging noise — ship silently.

Two ingredients to fix this already exist in the repo but are **unwired**:

1. **Real labelled data is thrown away.** Every time a reviewer accepts or dismisses a finding
   (`FindingActionKind` = `accept | dismiss | learn | reply`, `findings.ts:82`) they are
   producing a ground-truth label — "this finding was right" / "this finding was noise" — that
   is never captured as a reusable test.
2. **The eval foundation is scaffolded but empty.** The `eval_cases` and `eval_runs` tables
   exist (`server/src/db/schema/eval.ts:7-35`), the Zod contracts exist (`EvalCase`, `EvalRun`,
   `EvalDashboard`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint` — `knowledge.ts:58-84`,
   `eval-ci.ts:20-89`), agents already carry a `version` integer and a full `agent_versions`
   config-history table (`agents.ts:33,38-49`; `AgentVersion` at `knowledge.ts:287-292`) — but
   **no eval routes, no scorer, and no eval UI exist**. This is the "schema given ready"
   foundation this spec builds on.

This feature turns accepted/dismissed findings into a **fixed regression dataset**, runs an
agent's *current* prompt version over that fixed set, and computes **recall / precision /
citation_accuracy** in pure deterministic code (zero LLM calls in scoring). Because the inputs
are frozen, two runs — "old prompt v6" vs "new prompt v7" — are directly comparable, so a prompt
edit's effect on quality becomes a number, not a hunch. It is the product-level analogue of the
harness-level `evals/` package (which tests skills/subagents); the two are **separate** and this
spec touches only the product.

This is deliberately the Eval-Pipeline half of the "Eval Pipeline + Export your own agent" lab.
**Export-agent is out of scope** here and deferred to a follow-up spec (Open Question 4).

## Goals / Non-goals

**Goals**

- **One-click case creation from a real finding.** A `FindingCard`
  (`client/.../findings/FindingCard/FindingCard.tsx`) gains a "Turn into eval case" action.
  An **accepted** finding becomes a `must_find` case ("agent MUST flag X at file:line"); a
  **dismissed** finding becomes a `must_not_flag` case ("agent must NOT flag Y"). The case saves
  the diff fragment as `input_diff` and the derived expectation as `expected_output`; the type is
  derived from the accept/dismiss state, not asked.
- **Case management per agent.** An **Evals** tab in `AgentEditor`
  (`client/.../AgentEditor/AgentEditor.tsx:26-34`) lists an agent's eval cases with per-case
  pass/fail, supports a "New eval case" modal (input = Diff / Files / PR-meta tabs; expected =
  a findings-JSON skeleton), and offers **Run-all-evals**.
- **Fixed-input runs.** Running an agent over its case set uses the **frozen** case inputs
  (`input_diff` / `input_files` / `input_meta`) so runs of different agent/prompt versions are
  comparable. The agent's *current* prompt version is recorded on the run group.
- **Code-computed metrics.** Each run produces `recall`, `precision`, `citation_accuracy` per case
  (persisted on `eval_runs`, `eval.ts:30-32`) and aggregated per run group; scoring is a **pure
  function** with **zero LLM calls**.
- **Run history + compare.** A per-agent dashboard shows a metric-trend chart and a recent-runs
  table, and lets the user select **two runs → Compare** (metric deltas + a **system-prompt diff**
  between the two versions + a **Promote version** action).
- **Cross-agent dashboard.** A left-sidebar **Eval Dashboard** page lists all reviewer agents with
  their current recall/precision/citation, recent runs across agents, and a **Run all agents**
  action (populating the existing `EvalDashboard` aggregate contract, `eval-ci.ts:68-89`).
- **Reuse the grounding gate for `citation_accuracy`.** `citation_accuracy` is the fraction of the
  agent's emitted findings that survive `groundFindings` (`reviewer-core/src/grounding.ts`, exported
  at `reviewer-core/src/index.ts:23`; behaviour in `reviewer-core/docs/grounding-gate.md`) against
  the case's fixed `input_diff` — not a reinvented citation check.
- **A green verification gate** (`verify:l06`) that asserts the code scorer is deterministic and
  LLM-free (Open Question 5 / AC-11).

**Non-goals** (explicitly out of scope for this spec)

- **"Export your own agent."** The companion lab feature. Deferred to a separate follow-up spec
  (Open Question 4). Nothing in this spec builds export/plugin/CI-bundle surfaces.
- **Skill evals.** `eval_cases.ownerKind` already allows `skill | agent` (`eval.ts:12`), but this
  spec scopes the UI and runs to **agent** owners. Skill-owned cases are schema-compatible but not
  built here.
- **Changing the "given ready" schema** beyond the single, minimal, additive run-group extension in
  Open Question 1 (if adopted). `eval_cases`/`eval_runs` columns are not renamed or dropped.
- **LLM-judged / semantic scoring.** Matching is mechanical (file + line-range intersection).
  Semantic "is this the same finding" judging is explicitly not built — it would reintroduce LLM
  cost and hallucination into scoring (mirrors `grounding-gate.md:23-30`).
- **Auto-generating cases** or mining the whole finding history automatically. Case creation is the
  explicit one-click action from a specific finding; bulk/auto mining is out of scope.
- **Regression gating in CI** (blocking a merge on an eval delta). The dashboard surfaces deltas;
  wiring them into a merge gate is a later concern.

## User stories

- As a **reviewer**, I want to turn a finding I just accepted (or dismissed) into an eval case in
  one click, so the agent is held to that judgment on every future run without me re-labelling.
- As an **agent author**, I want to run my agent over its whole fixed case set and see
  recall/precision/citation as numbers, so I know whether my prompt is good before I ship it.
- As an **agent author**, I want to edit the system prompt, re-run the **same** cases, and compare
  the two runs side by side (metric deltas + prompt diff), so I can see whether v7 beats v6 and
  **promote** the winner.
- As a **studio operator**, I want a dashboard of all agents' current recall/precision/citation and
  recent runs, and a "Run all agents" button, so I can spot a regressed agent at a glance.
- As a **studio operator**, I want scoring to make **zero** LLM calls, so eval runs are cheap,
  deterministic, and repeatable (the same run twice yields identical metrics).

## Acceptance criteria (EARS)

Case creation (one click, both expectation types)

- **AC-1** — WHEN a user clicks "Turn into eval case" on an **accepted** finding, the system shall
  create an `eval_cases` row (`eval.ts:7`) with `ownerKind = 'agent'`, `ownerId` = the reviewing
  agent, `inputDiff` = the finding's diff fragment, and an `expectedOutput` encoding a **`must_find`**
  expectation for that finding's `file` + `[start_line..end_line]` (`findings.ts:52-54`).
- **AC-2** — WHEN a user clicks "Turn into eval case" on a **dismissed** finding, the system shall
  create an `eval_cases` row whose `expectedOutput` encodes a **`must_not_flag`** expectation for
  that finding's `file` + line range — i.e. the agent must **not** emit an intersecting finding.
- **AC-3** — The `expectedOutput` jsonb (`eval.ts:18`) shall represent both expectation types over
  the existing `Finding` shape (`findings.ts:47-62`): a `must_find` case carries a non-empty set of
  expected findings; a `must_not_flag` case carries an explicitly-empty expected set **plus** the
  forbidden `file`+range(s) it is stressing (see D3). Both types shall be scorable by the same code
  scorer.
- **AC-4** — WHEN an eval case is created from a finding, the creation shall be a single user action
  (one click) with no further required input, the derived `type` coming from the finding's
  accepted/dismissed state, not from a user prompt.

Case set & fixed inputs

- **AC-5** — An agent's eval-case set (`eval_cases WHERE ownerKind='agent' AND ownerId=:agentId`,
  workspace-scoped) shall be able to hold **≥ 8** cases and list them all in the AgentEditor Evals
  tab.
- **AC-6** — WHEN an agent is run over its case set, the run shall use each case's **stored**
  `inputDiff` / `inputFiles` / `inputMeta` (`eval.ts:15-17`) verbatim as the review input, and shall
  **not** re-fetch or re-derive the diff from the live PR — so the inputs are fixed and runs of
  different prompt versions are comparable.
- **AC-7** — WHEN an agent is run over its case set, the system shall record, for the run, the agent's
  **current prompt version** (`agents.version`, `agents.ts:33`) so a later Compare can diff the two
  versions' `system_prompt`.

Scoring (pure code, zero LLM)

- **AC-8** — WHEN a case is scored, the system shall consider an expected finding **matched** iff an
  emitted finding has the **same `file`** AND its `[start_line..end_line]` **intersects** the
  expected `[start_line..end_line]` (inclusive overlap) — the same file+line-range-intersection rule
  the grounding gate uses for diff lines (`grounding-gate.md:9-14`).
- **AC-9** — WHEN a run over a case set completes, the system shall compute `recall` =
  (matched expected `must_find` findings) / (total expected `must_find` findings), as a fraction in
  `[0,1]` (matching `EvalRun.recall`, `knowledge.ts:59`). WHERE there are zero expected findings,
  `recall` shall be defined as `1` (vacuously satisfied) rather than `0/0`.
- **AC-10** — WHEN a run over a case set completes, the system shall compute `precision` =
  (emitted findings that are **not** false positives) / (total emitted findings), where a
  `must_not_flag` case's forbidden target being flagged counts as a **false positive**; the
  `must_not_flag` cases are the precision stressors. WHERE zero findings are emitted, `precision`
  shall be defined as `1`.
- **AC-11** — WHEN a run is scored, the scorer shall make **zero** LLM calls — matching, recall,
  precision, and citation_accuracy shall be computed by pure deterministic code (no network, no
  provider) — and the `verify:l06` gate (AC-19) shall assert this.
- **AC-12** — WHEN a case is scored for `citation_accuracy`, the system shall compute it as the
  fraction of the agent's **emitted** findings that survive `groundFindings` against the case's fixed
  `inputDiff` (`reviewer-core/src/index.ts:23`; `grounding-gate.md`), reusing the existing gate rather
  than a new citation check. WHERE zero findings are emitted, `citation_accuracy` shall be defined
  as `1`.
- **AC-13** — WHEN a run over a case set completes, the system shall persist one `eval_runs` row per
  case (`eval.ts:22-35`) with `actualOutput`, `pass`, `recall`, `precision`, `citationAccuracy`,
  `durationMs`, and (nullable) `costUsd`, and shall associate those rows with the run group
  (per Open Question 1 / D1).
- **AC-14** — WHEN the identical case set is scored twice against the identical emitted output, the
  computed `recall`, `precision`, and `citation_accuracy` shall be byte-identical — scoring is a
  deterministic pure function of (expected, emitted, diff).

Runs, history & compare

- **AC-15** — WHEN a user opens an agent's run history, the system shall return that agent's runs
  newest-first with their aggregate `recall` / `precision` / `citation_accuracy`, prompt version, and
  total cost, populating the `EvalTrendPoint[]` / `EvalRunRecord[]` and `EvalDashboard` contracts
  (`eval-ci.ts:57-89`).
- **AC-16** — WHEN a user selects **two** runs and opens Compare, the system shall show the per-metric
  **delta** (`EvalDashboard.delta`, `eval-ci.ts:80-84`) and the **`system_prompt` diff** between the
  two runs' recorded agent versions (resolved from `agent_versions` / `AgentVersion.config`,
  `agents.ts:38-49`, `knowledge.ts:287-292`).
- **AC-17** — WHEN a user changes an agent's `system_prompt` (producing a new `agents.version`) and
  runs the **same** fixed case set before and after, the two runs' `recall` and/or `precision` shall
  be independently computed from each run's emitted output — i.e. a prompt change that changes the
  emitted findings shall move the metrics between the two runs (this is the observable, demoable
  payoff; the *direction* of movement depends on LLM behaviour and is a manual demo step, not an AC).
- **AC-18** — WHEN a user clicks **Promote version** in Compare, the system shall set the agent's
  active configuration to the chosen run's recorded version via the existing agent-version mechanism
  (`agent_versions` + `agents.version`, `agents.ts:33,38-49`) without creating a divergent
  versioning scheme.

Verification gate

- **AC-19** — The repo shall expose a `verify:l06` script (mirroring the `verify:l03` convention,
  `server/package.json:12` — `tsc --noEmit && vitest run <pattern>`) that (a) type-checks and
  (b) runs the eval-scorer unit tests, which assert scoring is deterministic (AC-14) and makes zero
  LLM calls (AC-11) — e.g. by scoring with a **no-provider** / throwing LLM stub and asserting it is
  never invoked. The gate shall be green.

Dashboard

- **AC-20** — WHEN the Eval Dashboard page loads, the system shall list every reviewer agent with its
  current `recall` / `precision` / `citation_accuracy` and recent runs, and offer a **Run all agents**
  action that runs each agent over its own fixed case set.

## Edge cases

- **Empty case set.** An agent with zero eval cases → Evals tab shows an empty state; "Run-all"
  produces an empty run (no rows), and dashboard metrics render as "no data", not `0`. (Vacuous-truth
  rule for `recall`/`precision`/`citation` on zero denominators — AC-9/AC-10/AC-12.)
- **`must_not_flag` case with no forbidden hit.** The agent emits nothing intersecting the forbidden
  target → the case passes; it contributes to `precision` only as a non-false-positive.
- **`must_find` expected finding never emitted.** Recall drops for that run; the per-case row is
  `pass = false`. This is the regression signal, not an error.
- **Multi-line ranges & partial overlap.** Matching is **intersection**, not equality — an emitted
  `[10..14]` matches expected `[12..12]` (AC-8, mirroring `grounding-gate.md:44-45`). Same file is
  required; a right file / wrong line does not match.
- **Same finding at same file:line created twice as a case.** Duplicate cases are allowed (they are
  distinct rows); scoring double-counts them. Dedup is a nicety, not required here — flag if the user
  wants dedup-on-create.
- **Frozen input drift.** The case's `inputDiff` is a **snapshot**; if the underlying PR later
  changes, the case does **not** track it (that is the point — fixed inputs). A case can therefore
  reference code that no longer exists; this is acceptable and intended.
- **Concurrency / two Run-all in flight for one agent.** Two overlapping runs each write their own
  run group; they must not corrupt each other's rows. Recommend each run group gets a distinct id at
  start (D1) so rows never interleave. (Whether to serialize per-agent is D1's follow-on — default:
  allow concurrent, distinct groups.)
- **Oversized / malformed `input_files` or `expected_output` jsonb.** These are stored jsonb
  (`eval.ts:17-18`); a malformed `expected_output` that does not parse against the expectation shape
  shall fail the **case**, not the whole run (skip + surface, mirroring SPEC-01 AC-16's never-fail-
  the-batch stance).
- **Agent deleted / version pruned after a run.** A run references a version that may later be gone.
  Compare shall degrade gracefully (show "version unavailable" rather than error) when a recorded
  version can't be resolved.
- **Citation of a file not in the case diff.** An emitted finding whose file isn't in `inputDiff` is
  dropped by `groundFindings` and lowers `citation_accuracy` (AC-12) — exactly the grounding-gate
  behaviour (`grounding-gate.md:43`).

## Non-functional

- **Performance / budget.** Scoring is O(expected × emitted) per case with a pure line-range
  intersection — no network, no LLM (AC-11). The only LLM cost in the whole pipeline is the agent's
  own review call per case during a run (which is the thing being evaluated); **scoring adds zero**.
  A "Run all agents" cost is bounded by (agents × cases) review calls and is surfaced via the
  per-case `costUsd` sum (`eval.ts:34`; `EvalDashboard.current.cost_usd`, `eval-ci.ts:78`).
- **Onion / boundary (what, not how).** Contracts (Ring 1) are the Zod shapes in
  `server/src/vendor/shared/contracts/` (source of truth; `client/src/vendor/shared/` is the
  read-only copy) — the eval contracts already exist (`eval-ci.ts`, `knowledge.ts:49-84`); any
  run-group addition (D1) extends them there. Routes = Ring 4 (`modules/agents/routes.ts` pattern,
  schema-first via `fastify-type-provider-zod`), service = Ring 2, repository = Ring 3
  (`modules/agents/{service,repository}.ts`). See the `zod` skill for contract vocabulary; this spec
  fixes the *what* (shapes crossing the boundary), not the Zod authoring or DDL.
- **Where the scorer lives (decided — D6).** The code scorer shall be a **pure function in a server
  service** (Ring 2, e.g. `server/src/modules/agents/` eval helpers), **not** in `reviewer-core`.
  Rationale: `reviewer-core` is the pure *review engine* (diff → prompt → LLM → grounded findings,
  `reviewer-core/AGENTS.md`) and already exports the one primitive the scorer must **reuse** —
  `groundFindings` (`reviewer-core/src/index.ts:23`). The scorer's job (compare expected vs emitted,
  compute recall/precision) is *eval domain*, not review domain, and depends on the eval contracts
  which live server-side; putting it in `reviewer-core` would widen that package's surface beyond its
  charter. The scorer stays pure (no DB/LLM) by taking `(expected, emitted, diff)` in and returning
  metrics — the DB read/write is the repository's job (Ring 3), the review call is the run
  orchestrator's job. This preserves both the onion rings and `reviewer-core`'s "no side effects
  beyond LLMProvider" invariant.
- **a11y.** Metric deltas and pass/fail shall not be conveyed by color alone — up/down and
  pass/fail shall also carry a textual/iconic label (mirrors SPEC-02 AC's a11y stance). The prompt
  diff in Compare shall be keyboard-navigable.
- **Observability.** Each run group records prompt version + aggregate metrics + total cost so a
  regression is attributable to a specific version; per-case rows retain `actualOutput` for
  drill-down (`eval.ts:28`).
- **Security / tenant safety.** All eval reads/writes are workspace-scoped via
  `eval_cases.workspaceId` (`eval.ts:9-11`); a case or run for one workspace's agent shall never be
  listed or scored for another workspace's agent (mirrors the agents module's workspace scoping,
  `routes.ts:81`).

## Inputs (provenance)

- **Accepted / dismissed finding + its diff fragment** (case source) — `[reused: L02–L05]`
  (the persisted `Finding` and its `FindingActionKind` accept/dismiss state, `findings.ts:47-83`;
  read, not re-derived).
- **Stored case inputs** (`inputDiff` / `inputFiles` / `inputMeta`) — `[deterministic: repo-intel]`
  (frozen jsonb/text snapshots read verbatim, `eval.ts:15-17`; no LLM).
- **Agent prompt version + config** — `[reused: L02+]` (`agents.version`, `agent_versions` /
  `AgentVersion`, `agents.ts:33,38-49`, `knowledge.ts:287-292`).
- **Grounding gate result for `citation_accuracy`** — `[deterministic: repo-intel]`
  (`groundFindings` is a pure diff-parse, `reviewer-core/src/grounding.ts`; zero LLM,
  `grounding-gate.md:23-30`).
- **Scoring metrics** (recall / precision / citation_accuracy) — `[deterministic: repo-intel]`
  (pure code, `[new: 0 LLM call]`).
- **The agent review call *per case during a run*** — `[reused: L02+]` (the existing reviewer
  pipeline `reviewPullRequest`, `reviewer-core/src/index.ts:39`; this is the agent under test, **not**
  part of scoring). One review call per case per run; **scoring itself adds zero LLM calls**.

## Untrusted inputs

**Present.** The stored `inputDiff` / `inputFiles` / `inputMeta` of a case originate from a PR diff
(attacker-influenceable) and are replayed into the reviewer pipeline when the agent is run over the
case. They are already handled as **data, not commands** by the existing engine — the diff and all
PR-derived text pass through `wrapUntrusted` under the shared `INJECTION_GUARD`
(`reviewer-core/src/prompt.ts`, per `reviewer-core/AGENTS.md` "Injection defense is `INJECTION_GUARD`,
not keyword scanning"). This spec adds **no new** untrusted surface into the prompt: it reuses the
same review path, and the **scorer never sends case content to an LLM** (AC-11), so eval-specific
text (the `expected_output` labels, case names, notes) is consumed only by deterministic code and
never reaches a model. No keyword/denylist scanning is added — the existing guard is the defence.

## Open Questions / Decisions needed

Each item states a **recommended default** (the spec is written on it).

**Decisions LOCKED (2026-07-12, by the user — the plan proceeds on these):**
- **D1 — LOCKED: add the additive `eval_run_groups` table** (option a) + a nullable `run_group_id`
  FK on `eval_runs`. Nothing in `eval_cases`/`eval_runs` is renamed or dropped.
- **D3 — LOCKED:** `must_find` / `must_not_flag` live inside the existing `expectedOutput` jsonb,
  discriminated by a `type` field (+ a `forbidden: [{file,start_line,end_line}]` list for
  `must_not_flag`). No schema change.
- **D4 — LOCKED: defer "Export your own agent" to a separate SPEC-04.** Out of scope here.
- **D5 — LOCKED: gate name `verify:l06`** = `tsc --noEmit && vitest run <scorer pattern>`; it also
  asserts the D1 migration applies cleanly.
- **D2 / D6 — resolved as written:** reuse `agents.version` + `agent_versions` for Compare/Promote;
  scorer is a pure server-service function (Ring 2) reusing `groundFindings`; no other schema edits.

1. **Run-group modeling — `[NEEDS CLARIFICATION]` (D1, recommended).** `eval_runs` is **per-case**
   (`eval.ts:22-35`), but the dashboard needs a per-run-**GROUP** concept: a version label (v6/v7),
   the agent's prompt version, aggregate recall/precision/citation, total cost, and compare/promote.
   The `EvalDashboard` / `EvalTrendPoint` / `EvalRunRecord` contracts (`eval-ci.ts:57-89`) already
   imply an aggregate but there is no group **row** the per-case rows point to.
   **Recommended (D1): add a minimal, additive `eval_run_groups` table** (id, workspaceId, ownerKind,
   ownerId, agentVersion, label, ranAt, aggregate recall/precision/citationAccuracy, totalCostUsd)
   and a nullable `run_group_id` FK on `eval_runs`. This is onion-safe (a new Ring-1 contract + a
   Ring-3 table), keeps aggregates first-class and cheap to query, and avoids the fragile
   `(ownerId, ranAt-batch)` heuristic of option (b). The schema was labelled "given ready", so this is
   flagged as the one **proposed additive** change — the alternative (derive-by-batch + a `label`
   column on `eval_runs`) is viable if the user prefers zero new tables. **Decision needed: add the
   table, or derive the group.**

2. **Agent prompt versioning for Compare/Promote — resolved (no change needed).** Verified in-repo:
   `agents.version` (integer, `agents.ts:33`) plus the `agent_versions` config-history table
   (`agents.ts:38-49`) and the `AgentVersion` contract (`knowledge.ts:287-292`) already model
   v6→v7 and expose per-version `config` (incl. `system_prompt`). **Recommendation: reuse this as-is**
   for the version diff (AC-16) and Promote (AC-18); do **not** introduce a parallel versioning
   scheme. No open decision unless the user wants an explicit human-facing label distinct from the
   integer version.

3. **`must_find` / `must_not_flag` mapping onto `expected_output` — recommended (D3).**
   **Recommended:** `must_find` = `expected_output` carries a **non-empty** array of expected
   `Finding`-shaped entries (the finding(s) the agent must emit); `must_not_flag` = `expected_output`
   carries an **explicitly-empty** expected-findings array **plus** a `forbidden: [{file, start_line,
   end_line}]` list naming the target(s) that must not be flagged (a bare `[]` alone can't tell the
   scorer *which* flag is the false-positive stressor). A small discriminator (e.g. `type:
   'must_find' | 'must_not_flag'`) on the jsonb makes the scorer unambiguous. **Confirm this shape**
   (it stays inside the existing `expectedOutput` jsonb, no schema change).

4. **"Export your own agent" — recommended: defer.** The parent lab is "Eval Pipeline + Export your
   own agent," but only the Eval Pipeline is specified in the provided materials. Notably, export
   contracts **already exist** in the repo (`CiExportInput`, `CiExport`, `AgentManifest`,
   `eval-ci.ts:133-203`), which suggests a substantial companion feature. **Recommendation: defer
   Export-agent to a separate follow-up spec (SPEC-04)** rather than half-specifying it here — it has
   its own contracts, CI-target matrix, and untrusted-surface (opening PRs into external repos) that
   deserve their own EARS treatment. This spec's scope is Eval Pipeline only.

5. **Verification gate naming — recommended.** The repo convention is `verify:l0N` = `tsc --noEmit &&
   vitest run <pattern>` (`server/package.json:12`, `client/package.json:11`). **Recommended: add
   `verify:l06`** asserting (a) typecheck and (b) the scorer unit tests prove determinism (AC-14) and
   zero-LLM (AC-11, via a throwing provider stub). **Confirm the label `l06`** and whether the gate
   should also assert the migration for D1 (if adopted) applies cleanly.

6. **Whether to change the provided schema at all — recommended: only D1, and only if adopted.**
   Aside from the optional additive `eval_run_groups` table + nullable FK (Open Question 1), **no
   change** to `eval_cases` / `eval_runs` is needed — the metric columns (`recall`, `precision`,
   `citationAccuracy`), `actualOutput`, `pass`, `durationMs`, `costUsd` all already exist
   (`eval.ts:29-34`). The `must_find` / `must_not_flag` distinction lives entirely inside the existing
   `expectedOutput` jsonb (D3). **Confirm: no other schema edits.**
