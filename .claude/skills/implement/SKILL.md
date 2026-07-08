---
name: implement
description: Execute an existing Development Plan end-to-end — implementer waves → completeness gate → architecture review with fix iterations → test coverage → bug review → final verification → sign-off. Use when a plan exists in docs/plans/ and the user wants it implemented and verified. Spec creation and planning are NOT part of this command — run spec-creator and implementation-planner separately first.
argument-hint: "docs/plans/<plan>.md"
---

# Implement — Development Plan Execution Orchestrator

You are the orchestrator, running in the main session. You take a **finished Development Plan** and drive it to a verified, signed-off implementation by spawning the project agents (implementer, plan-verifier, architecture-reviewer, test-writer, doc-writer), enforcing quality gates, and capping fix loops. **You never write product code, tests, or docs yourself — the agents own their write surfaces.** Your Bash use is limited to verification commands (typecheck, test runs) between phases.

**Out of scope by design:** creating or revising specs (spec-creator) and creating plans (implementation-planner) — the user runs those manually before invoking this command. If no plan exists, say so and stop; do not draft one.

## Phase 0 — Intake

1. Resolve the plan: use the path from the arguments; if none given, list `docs/plans/` newest-first and ask the user which one.
2. Read the plan in full: execution mode (multi/single-agent), parallelization map, owned paths, Testing Plan, referenced spec.
3. Sanity checks — stop and report instead of proceeding if: the plan file doesn't exist; steps lack owned paths in multi-agent mode; or the working tree has unrelated uncommitted changes the user hasn't acknowledged.

## Phase 1 — Implementation (implementer ×N)

Follow the plan's parallelization map. For each wave: spawn one implementer per task **in parallel** (one Agent call per task, all in a single message), each instructed to run only the tests covering its owned paths. Wait for the wave to finish before starting the next. Single-agent mode: one implementer, tasks strictly in order.

**Maximize wave width.** Before spawning a wave, check the plan's map against the steps' owned paths: any two steps with disjoint owned paths and no declared dependency belong in the SAME wave. If the plan serialized steps that are actually independent, widen the wave yourself and note the deviation in the final report. (A prior full run stalled at max-concurrent 2 across 8 independent-ish steps — that is the failure mode to avoid.)

**Inject, don't point.** Give each implementer *its own step text* (copied from the plan) plus the contents/paths of the files it owns and the shared files it depends on — not "read the plan and find step N". Every agent re-reading the whole plan and re-discovering the same module is the dominant subagent cache-read cost (in the reference run the plan was re-read in 15 contexts, one module's files 10–11× each). Paste the step + a digest of the owned/shared files into the task prompt for THAT wave.

If an implementer stops on ambiguity → relay the question to the user, then continue the SAME instance via SendMessage with the answer (never respawn mid-task — it loses context).

## Phase 2 — Full local gate

Once per affected package: `pnpm typecheck`, then the full hermetic suite (`pnpm exec vitest run --reporter=dot --exclude '**/*.it.test.ts'` in `server/`, `pnpm exec vitest run --reporter=dot` in `client/`). Failures → fix via an implementer before proceeding.

## Phase 3 — Completeness gate (plan-verifier, pass 1)

Spawn plan-verifier with: "pass 1 — verify Implementation Steps and Acceptance Criteria only; report Testing Plan rows as pending". For each ❌/⚠️: spawn an implementer with the gap as its task, then **re-verify by continuing the SAME plan-verifier via SendMessage** ("re-check only AC-n / Step-n just fixed") — it keeps the plan and codebase map warm; a fresh verifier pays a cold cache-read for context it already had. **Loop cap: 2 iterations**, then stop and escalate the remaining gaps to the user.

## Phase 4 — Architecture review ∥ test coverage

Spawn IN PARALLEL (one message, two Agent calls):

- **architecture-reviewer**, scoped to the modules the plan touched
- **test-writer**, one instance per Testing Plan row group (pass the target files from the plan)

They cannot conflict: the reviewer is read-only; test-writer writes only test files.

## Phase 5 — Architecture fix iterations

From the reviewer's report:

- **Critical / High** → mandatory fixes: spawn implementer(s) with the findings verbatim as tasks (file:line + remediation hint). After the fixes: re-run typecheck + the tests affected by the touched files, then **re-review by continuing the SAME architecture-reviewer via SendMessage, scoped to the touched files only** — never a fresh reviewer instance. The original reviewer already holds the module context warm; a cold re-spawn on a tiny scoped re-check wastes a full cache-read (a reference run's scoped re-review ran at 77.5% cache-hit for this reason). Repeat until zero Critical/High. **Loop cap: 2 iterations**, then escalate the remaining findings.
- **Medium / Low** → report to the user; fix only the ones the user picks (same mechanism, counted inside the same cap).

If a fix moved or renamed source files, the fixing implementer also updates the co-located tests (typecheck enforces this).

## Phase 6 — Bug review (/code-review)

Invoke the `code-review` skill on the working diff. Confirmed correctness bugs → fix via implementer → re-run the affected tests. Simplification/style findings → report only. Same loop discipline (cap 2).

## Phase 7 — Final verification (plan-verifier, final pass)

Spawn plan-verifier with: "final pass — verify everything, including the Testing Plan". The ✅ report is the sign-off artifact — include it in the final report. A ❌ here after the earlier gates means something regressed during fixes: one targeted fix round, then escalate.

## Phase 8 — Closeout

1. If the plan calls for documentation (or the user asks): spawn doc-writer.
2. Run engineering-insights Mode B for the session.
3. Deliver the final report. If the plan references a spec, remind the user to flip its Status → `implemented` via spec-creator (not this command's job).

## Hard Rules

- **Loop caps are absolute.** Each fix loop (Phases 3, 5, 6, 7) runs at most 2 iterations; after that stop, summarize what remains, and let the user decide. Never grind in circles.
- **Checkpoints that always require the user:** plan selection when ambiguous, every escalation, Medium/Low fix selection, anything destructive.
- **Token economy:** implementers run scoped tests only; the full suite runs once per phase that changed code; vitest always with `--reporter=dot`; reviewer re-runs are scoped to touched files, never the whole module again.
- **Continue vs respawn:** continue an in-phase agent with SendMessage; use a NEW instance only for genuinely new work. A **fix** is new work → its own fresh implementer (clean context on the finding). A **re-review or re-verify of the same scope** is NOT new work → continue the original architecture-reviewer / plan-verifier via SendMessage so its warm module map is reused, not paid for twice.
- **Do not parallelize across phases.** Waves inside Phase 1 and the pair in Phase 4 are the only parallel points; the gates are serial by design.
- **On interruption or hard failure** (e.g. Docker missing for integration tests): report which phases completed and which artifacts exist, so the run can resume from the failed phase — never from scratch.

## Final Report

```
## Plan executed: <feature>

**Plan:** <path> (<N> steps, <execution mode>)
**Spec:** <path or "—"> (remind: flip Status → implemented via spec-creator)
**Implementation:** <N> tasks across <M> waves · fix iterations used: completeness <n>/2 · architecture <n>/2 · bugs <n>/2
**Verification:** <N ✅ · M ⚠️ · P ❌> (final plan-verifier report above)
**Architecture:** <0 Critical · 0 High · n Medium/Low reported>
**Tests:** typecheck ✓ · hermetic ✓ · integration ⚠️ skipped/needs Docker (if applicable)
**Escalations / open items:** <list or "none">
```
