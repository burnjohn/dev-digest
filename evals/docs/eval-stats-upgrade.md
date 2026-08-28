# Implementation Plan: Eval statistics upgrade (skill-creator v2 parity, trimmed)

> Place this file at `docs/plans/eval-stats-upgrade.md` and execute with
> `run-plan plan:docs/plans/eval-stats-upgrade.md` (or hand it to a single Opus session).
> All work is confined to the `evals/` package — no product code is touched.

## Overview

Upgrade the `evals/` package from binary pass/fail tracking to the statistical core of
Anthropic's skill-creator v2: persisted per-run records (full output text + trace + per-practice
verdicts + resource metrics), a with-artifact vs without-artifact benchmark (N runs per
configuration, mean ± stddev / min / max, delta, deterministic analyst flags), and per-practice
statistics in the existing `repeat`/`delta` version-comparison loop. Deliberately trimmed:
no git-worktree baselines (label discipline covers version-vs-version), no data-driven case DSL
(deferred until the case count justifies it).

**Phase 0 (added):** before any statistics work, split the `harness.ts` god-module into a modular
`src/` tree (config / runtime / artifacts / tasks / scoring / logging / dsl), add a barrel
`index.ts`, and move each case's prompt/practices/threshold into a colocated `*.cases.ts` data
file behind a `describe*` + `run*Cases` DSL. Pure refactor, behavior-preserving, zero live runs.
The statistics tasks then land in the right module from the start instead of growing the god-file.

## Execution mode

single-agent (one pass) — the package is ~8 small files with heavy path overlap between tasks
(`harness.ts`, `repeat.ts`, `delta.ts` are each touched by several tasks); parallelism would buy
nothing and cost owned-path gymnastics.

## Requirements (verified)

- R0: The `src/` tree SHALL be modular with one responsibility per module and one-directional
  dependencies (config knows nothing of runtime; runtime nothing of scoring; dsl composes). Eval
  files SHALL import from a single barrel (`src/index.ts`). Each case's data (prompt, practices,
  grounding, threshold, maxTurns, kind) SHALL live in a colocated `*.cases.ts` next to the thin
  `*.eval.ts`. The measure → record → assert body SHALL be encapsulated once in a `run*Cases`
  helper, not copy-pasted per test. Behavior is preserved: the same cases pass as before.
- R1: Every eval test run SHALL persist a full record: prompt label, final output text, tool/agent
  trace, per-practice judge verdicts (text/passed/evidence), grounding results, resource metrics,
  git sha, and the configuration it ran under. Records survive across runs and are re-readable.
  The `record()` call SHALL execute even when the test's assertions fail: measurement is
  separated from assertion (try/finally), so a failing configuration still leaves a record.
- R2: The harness SHALL capture resource metrics exposed by the Agent SDK result message per run:
  `num_turns`, `duration_ms`, input/output token usage, and total tool-call count (non-deduplicated).
- R3: `eval:repeat` and `eval:delta` SHALL report statistics at **practice** granularity, not only
  test granularity: for each practice, pass rate across the N runs; for delta, per-practice change.
  This pair is the canonical version-vs-version comparison (baseline label BEFORE the edit,
  candidate label after — see R7).
- R4: A new `eval:benchmark <pattern> [-n runs=5]` command SHALL run a vitest pattern N times per
  configuration — `candidate` (artifact injected, as today) and `baseline` (NO artifact injected:
  raw model plus the no-tools directive) — and write
  `results/benchmarks/<timestamp>/benchmark.json` + `benchmark.md` with mean ± stddev / min / max
  for pass_rate, tokens, duration_ms, num_turns per configuration, plus the delta. Console output
  mirrors the summary table. This measures skill/agent LIFT — the with_skill vs without_skill
  comparison from skill-creator v2. No other baseline modes exist.
- R5: The benchmark report SHALL include deterministic analyst flags: `non_discriminating`
  (practice passes 100% in both configurations), `always_failing` (0% in both), `flaky` (pass rate
  strictly between 20% and 80% within a configuration), `cost_regression` (candidate mean tokens
  > 125% of baseline mean), and `missing_data` (a configuration has ZERO records for a test or
  practice). Reports SHALL render an empty series as `—` (n=0), never as a 0% pass rate — absent
  data and a measured zero are different findings.
- R6: Three existing defects SHALL be fixed: (a) the vacuous `numTurns <= maxTurns` assertion in
  the workflow eval; (b) the false "the evals don't depend on it" claim in `trend-reporter.ts`
  (`eval:repeat` reads its output); (c) `repeat-<label>.json` missing git sha/dirty provenance.
- R7: The README SHALL document the canonical version-comparison loop as a first-class workflow,
  not a footnote: `eval:repeat <pattern> -n N --label baseline` BEFORE editing the artifact →
  edit → `--label candidate` → `eval:delta baseline candidate`. The baseline must be captured
  before the edit; there is no mechanism to reconstruct it afterwards short of reverting.
- R8: One new **near-miss negative** activation case SHALL be added for `engineering-insights`:
  a prompt on the same topic as the positive case but phrased as a question, which must NOT
  activate the skill.

## Phased tasks

### Phase 0 — Modular split (behavior-preserving, no live runs)

- **T0a** Split `src/harness.ts` into: `config.ts` (models, thresholds, tool allow-lists, env
  keys), `ansi.ts`, `runtime/env.ts` (`subscriptionEnv`), `runtime/run-claude.ts` (`runClaude`
  + `Result`/`RunOptions`/`Metrics`), `artifacts/paths.ts` (lazy, env-overridable roots),
  `artifacts/load.ts` (`skillContent`/`agentContent`), `tasks.ts`
  (`skillTask`/`agentTask`/`workflowTask`), `scoring/pattern-match.ts`, `scoring/llm-judge.ts`
  (`llmJudge`/`parseVerdict`/`Verdict`/rubric), `logging/log.ts` (`logTrace`/`logVerdict`).
  Add `src/index.ts` barrel. `harness.ts` re-exports from the barrel for one release, then dies.
- **T0b** Add `dsl/describe.ts` (`describeSkill`/`describeAgent`/`describeWorkflow`) and
  `dsl/case.ts` (`SkillCase`/`AgentCase`/`WorkflowCase` types + `runSkillCases`/`runAgentCases`/
  `runWorkflowCases`, each doing the one true measure → record → assert body).
- **T0c** Move each existing case's prompt/practices/threshold into a colocated `*.cases.ts`;
  shrink each `*.eval.ts` to `describe* + run*Cases`. Verify with `pnpm typecheck` + one `-n 1`
  cheap run that the same cases pass.

(Statistics tasks T1–T11 as in the trimmed plan, now landing inside the modular tree.)

## Red-flags check

- [x] Every requirement maps to a task (R0→T0; R1→T2; R2→T1; R3→T6,T7; R4→T8,T9; R5→T5,T9;
      R6→T3; R7→T10; R8→T4)
- [x] Dependencies form a DAG (no cycles); Phase 0 precedes all statistics tasks
- [x] Every Acceptance is measurable (command + observable result)
- [x] No edits to existing shared contracts
