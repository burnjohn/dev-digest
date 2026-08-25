# Development Plan — Phase 5: Cost baseline + one optimization (lab Крок 8)

**Execution mode:** multi-agent (same split as Phases 2–4) — `implementer`
edits markdown/doc files only (agent prompts, skill body, `CHANGELOG.md`
entries, `docs/COST-BASELINE.md`); it does not hold `Bash` and does not run
evals. The **orchestrating session** (holds `Bash` + the Claude Code
subscription) runs `npm run eval:agents` / a filtered `npm run eval:workflow`
before and after the edit, reads `evals/results/records.jsonl`, and writes
the actual numbers into `docs/COST-BASELINE.md`. This mirrors Phase 4's
split (`marketplace-extraction-phase4.md:3-6`) and is the coordinator's
confirmed choice for this phase.

Working directory for every command below:
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

## Context

Phases 1–4 of the `dev-digest-ai-marketplace` extraction are complete: four
plugins exist, generalized, with a working `evals/` package that has
already proven two real behavior cases against the subscription
(`evals/README.md`'s real-vs-structural table). `docs/specs/marketplace-
extraction/architecture.md`'s Cost baseline experiment flow
(architecture.md:489-504) and AC-6 (architecture.md:628-631) are the one
remaining lab-mandated deliverable this phase covers: measure a baseline,
apply exactly one optimization, and record an honest before/after in
`docs/COST-BASELINE.md`, which is currently a stub
(`docs/COST-BASELINE.md:1-4`).

Coordinator's confirmed scope for this run:
- 3 repeats each of the two cases that are actually real (not structural)
  in this eval set: `spec-creator` quality case and the `AC-9` negative
  case — run **fresh**, on the current clean HEAD, not reusing the 5
  proof-of-concept records already sitting in `evals/results/records.jsonl`
  from today's Phase 4 work (different intent, not a controlled baseline —
  see Ordered steps Step 0).
- The optimization search is **not** artificially limited to
  `sdd-engineering` — it extends to `architecture-review` as well, because
  the one real duplicate instruction found during planning research spans
  both plugins' always-loaded agent prompts (see Constraints below).
  Both plugins get validated with `claude plugin validate` after the edit.

## Load-bearing finding from planning research (do not re-derive)

The "remove duplicated instructions between agent prompts and skill
references" candidate the lab recommends (`L08/04-hands-on-lab.md:280`)
already has a real, non-invented instance in this repo. The
"diff-artifact-reuse" convention — *if the orchestrating session supplies a
computed diff, treat it as ground truth for "what changed"; don't spend a
fresh `git diff`/`git status` pass re-deriving it* — is currently written
out in full, independently, in three places:

1. `plugins/sdd-engineering/skills/run-plan/SKILL.md` — Overview
   (paragraph starting "The diff-artifact-reuse convention...") and Step 2
   item 1 ("Compute the diff once this round..."). This is the **canonical**
   explanation — a skill body, loaded on demand, is exactly where the lab
   says the detail should live.
2. `plugins/sdd-engineering/agents/plan-verifier.md:29-38` (Step 0) —
   restates the same rule in full, with its own citation
   ("*Source: code.claude.com/docs/..., "Add an adversarial review
   step"...*"), even though `plan-verifier.md`'s body is **always** loaded
   whenever that agent runs (unlike a skill, which loads on demand).
3. `plugins/architecture-review/agents/architecture-reviewer.md:19-24`
   (`# Input — reuse what's already known`) — restates the same rule again,
   nearly the same wording, also always-loaded.

By contrast, `architecture-reviewer.md:44` already explicitly refuses to
inline a copy of the `onion-architecture` skill's *rules* ("Do not inline a
copy of its rules here — that would duplicate content between this agent's
prompt and the skill itself") — so the extraction's Phase 2 editorial pass
already caught the most obvious duplication shape. What it did **not**
catch is this second, more indirect shape: a *coordination convention*
(not a rule about code) repeated across two always-loaded agent prompts
that both happen to consume it, instead of being described once in the
skill that already documents it in full (`run-plan/SKILL.md`) and pointed
to briefly from the two agent prompts.

No git tag has been pushed for either plugin yet (`git tag -l` returns
nothing) — the immutable-tag invariant (architecture.md:546-548) does not
block this edit; there is no version bump strictly required by that
invariant, but both `CHANGELOG.md`s get a short entry regardless (see
Ordered steps Step 3) so a future 1.0.0 tag's changelog reflects the real
history of the file.

## Modules involved (all inside `dev-digest-ai-marketplace`; no
`dev-digest/**` file changes)

- `docs/COST-BASELINE.md` — stub replaced with the real baseline
  before/after record.
- `plugins/sdd-engineering/skills/run-plan/SKILL.md` — stays the canonical,
  full explanation of diff-artifact-reuse; unchanged in content, confirmed
  by re-read, not edited unless the trim elsewhere reveals a wording gap.
- `plugins/sdd-engineering/agents/plan-verifier.md` — Step 0 trimmed.
- `plugins/architecture-review/agents/architecture-reviewer.md` —
  `# Input` section trimmed.
- `plugins/sdd-engineering/CHANGELOG.md`,
  `plugins/architecture-review/CHANGELOG.md` — short "Unreleased" entries.
- `evals/results/` — regenerated by the orchestrating session's real runs
  (gitignored; safe to clear per `evals/README.md:128`).
- `INSIGHTS.md` (repo root) — an entry if the optimization run surfaces
  anything non-obvious (e.g. an unexpected noise-floor size), per this
  repo's own session-protocol convention already used in Phases 1–4.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **Model and routing held constant across the before/after comparison**
  (architecture.md:502-504, restated as an invariant at 580-583) — same
  `EVAL_MODEL`/`EVAL_JUDGE_MODEL` (`evals/src/config.ts`), same plugin
  versions except for the one prompt edit, same fixture prompts, same
  `maxTurns` values. Do not touch `evals/src/config.ts` or the fixture
  files in this phase.
- **"Within noise" must be recorded honestly, never an invented saving**
  (architecture.md:584-586, AC-6 architecture.md:628-631) — if the
  after-numbers don't clearly beat the before-numbers outside plausible
  run-to-run variance, `docs/COST-BASELINE.md` says so in those words.
- **English-only prose** in every committed file (architecture.md:587-591)
  — `docs/COST-BASELINE.md`, both `CHANGELOG.md` entries, and every edited
  agent/skill file.
- **No DevDigest-specific reference reintroduced** (architecture.md:549-557)
  — the trim must not accidentally copy in a DevDigest path/name while
  editing; re-check the final diff for `reviewer-core`, `@devdigest/shared`,
  `server/src/...`, `~/.devdigest/...`.
- **Namespaced cross-plugin references preserved** — the trimmed
  `plan-verifier.md`/`architecture-reviewer.md` text must still point to
  the skill by its correct form from each file's own position:
  `plan-verifier.md` lives inside `sdd-engineering`, so its own sibling
  skill `run-plan` can stay a bare reference (per this repo's own
  `INSIGHTS.md` 2026-08-25 "decision" entry: same-plugin references are
  bare, pending a `claude plugin validate` empirical check — this phase's
  Step 4 below is exactly that check, so resolve the bare-vs-namespaced
  question for this specific reference while doing it);
  `architecture-reviewer.md` lives in a **different** plugin
  (`architecture-review`) than `run-plan` (`sdd-engineering`), so its
  pointer **must** use the full `sdd-engineering:run-plan` form — this is
  a cross-plugin reference, not an internal one, and the existing file
  already uses this exact namespaced form correctly elsewhere
  (`architecture-reviewer.md:33`, `sdd-engineering:plan-verifier`).
- **`claude plugin validate` must stay green for both edited plugins**
  (architecture.md's CLI validation surface, architecture.md:278-290) —
  run it on `./plugins/sdd-engineering` and `./plugins/architecture-review`
  after the edit, per the coordinator's explicit instruction.
- **No secrets, no absolute local filesystem path in any committed file**
  (architecture.md `SECURITY.md` policy, AC-8) — applies to
  `docs/COST-BASELINE.md`'s recorded commit SHA/model name (fine) but not
  to any local path; if the plan needs to reference a local results file,
  reference it by its repo-relative path only.
- **Quality gate for accepting the optimization** (architecture.md:496-500):
  accept only if all three hold — quality gate stays green (pass rate
  unchanged or better, no new critical false negative on either case), AND
  cost or latency measurably decreases outside noise. Otherwise record
  "within noise."

## Skills the implementer will use

None of this harness's own skills apply directly to this task — it is a
targeted markdown trim across two already-written agent-prompt files plus
two `CHANGELOG.md` entries and one doc-stub fill-in, not React/Fastify/
Drizzle/onion-architecture code. The implementer does not need `Bash`,
`Write` beyond the five files named above, or any project-specific skill;
its job is purely editorial precision (remove duplication, preserve
meaning, keep the namespacing convention correct per the Constraints
section above).

## Ordered steps

### Step 0 — orchestrating session: get to a clean, known baseline state

1. Confirm `git status --short` is clean and note the current HEAD SHA —
   this is the "plugin + commit SHA" `docs/COST-BASELINE.md` records for
   the *before* row. (At planning time this was `837e545`; re-confirm at
   execution time, do not hardcode this value into the doc without
   re-checking, since further commits may land first.)
2. Clear `evals/results/` (`rm -rf evals/results`, safe per
   `evals/README.md:128` — gitignored, append-only, deletion is always
   safe) so the upcoming baseline run's `records.jsonl` contains only this
   phase's controlled runs, not today's earlier Phase 4 proof-of-concept
   records (different intent, per the coordinator's explicit instruction
   not to reuse them).

### Step 1 — orchestrating session: run the BEFORE baseline (3 repeats × 2 cases)

Run each of the following 3 times each, back to back, from `evals/`:

```sh
cd evals
npm run eval:agents                                    # spec-creator quality case — 1 case only, safe as-is
npx vitest run workflow -t "does not activate on an unrelated prompt (AC-9)"
```

Use the `-t` filter on the workflow command deliberately — `sdd-workflow.
cases.ts` has 7 entries and only the AC-9 case is real/in-scope for this
baseline (the other 6 are "structural only" per `evals/README.md`'s table);
running the bare `npm run eval:workflow` script would silently fire all 7
for real money, which is out of this phase's confirmed scope.

After all 6 runs, read `evals/results/records.jsonl` (6 new lines) and
compute, per case: median `metrics.durationMs` (→ latency), median
`metrics.inputTokens` + `metrics.outputTokens` (+ `metrics.cacheReadTokens`/
`cacheCreationTokens` if the record schema carries them — check the actual
JSON keys present, don't assume), median `metrics.toolCallCount`, pass rate
(fraction with `outcome: true`), and list any critical failure verbatim
(judge practice failures, non-PASS outcomes). Estimate cost from tokens
using the current published rate for the model in `evals/src/config.ts`'s
`EVAL_MODEL` (state the rate and its source in the doc — don't leave cost
as "unknown" if tokens are known).

### Step 2 — implementer: trim the duplicated diff-artifact-reuse text

1. **`plugins/sdd-engineering/agents/plan-verifier.md`**, Step 0 (currently
   lines ~22-38): keep the two required-inputs sentences and the
   "ask rather than guess scope" line; replace the paragraph that restates
   the diff-artifact-reuse convention in full (currently: "If the
   orchestrating session supplies a diff artifact directly... only the
   initial 'what changed' discovery is skipped.") with a single short
   pointer, e.g.: *"If a diff artifact is supplied directly, treat it as
   ground truth for 'what changed' rather than re-deriving it yourself —
   this is the diff-artifact-reuse convention `run-plan` documents in
   full."* Keep the `code.claude.com` citation line — it is real
   provenance, not duplicated prose, and stays useful even in the trimmed
   version.
2. **`plugins/architecture-review/agents/architecture-reviewer.md`**,
   `# Input — reuse what's already known` (currently lines ~15-24): same
   trim — keep the *behavior* (treat supplied diff/plan-verifier findings
   as ground truth, still verify each with own evidence) as one short
   paragraph, but drop the restated multi-sentence explanation of *why*,
   replacing it with a pointer to `sdd-engineering:run-plan`'s
   diff-artifact-reuse convention (full namespaced form — this is a
   cross-plugin reference, not internal to `architecture-review`).
3. **Do not edit `run-plan/SKILL.md`** — it remains the one place carrying
   the full explanation; re-read it once after the two trims above to
   confirm it still reads standalone (a reader following either agent
   prompt's pointer must find the complete story there, not a fragment).
4. Self-check: grep the three files afterward for the distinctive phrase
   "re-deriving it" (or similar) to confirm it now appears in exactly one
   place (`run-plan/SKILL.md`) plus the two short pointers, not three full
   copies.

### Step 3 — implementer: changelog entries (no version bump required)

Add an "Unreleased" section (or append to the existing `## 1.0.0` entry if
the coordinator prefers pre-release history folded in — default to a new
"Unreleased" heading since no tag has shipped yet) to both:

- `plugins/sdd-engineering/CHANGELOG.md` — one line noting
  `plan-verifier.md`'s diff-artifact-reuse explanation was trimmed to a
  pointer at `run-plan`'s existing full explanation (cost-optimization
  pass, Phase 5).
- `plugins/architecture-review/CHANGELOG.md` — same, for
  `architecture-reviewer.md`, noting the pointer is now the namespaced
  `sdd-engineering:run-plan` cross-plugin form.

### Step 4 — orchestrating session: validate both edited plugins

```sh
claude plugin validate ./plugins/sdd-engineering
claude plugin validate ./plugins/architecture-review
```

Both must report clean (no schema errors). This is also the empirical
check this repo's own `INSIGHTS.md` (2026-08-25 "decision" entry) deferred
for confirming whether same-plugin references may stay bare — record the
outcome for `plan-verifier.md`'s reference to `run-plan` as an `INSIGHTS.md`
entry if this run settles it either way.

### Step 5 — orchestrating session: run the AFTER measurement (3 repeats × 2 cases)

1. Confirm `git status --short` again and note the new HEAD/dirty state —
   this is the "plugin + commit SHA" for the *after* row (the working tree
   will be dirty relative to the *before* SHA unless the edit was
   committed first; note in the doc whether the after-run was against a
   commit or a dirty tree, per `records.jsonl`'s own `dirty` field).
2. Do **not** clear `evals/results/` this time — the same `records.jsonl`
   accumulating both before/after rows is fine, since each record carries
   its own `git_sha`/`dirty` field; distinguish before vs. after by that
   field when reading results back, not by wiping between runs.
3. Repeat Step 1's exact commands (same repeat count, same filters, same
   working directory) — nothing else changes. Compute the same
   median/pass-rate/failure numbers as Step 1.

### Step 6 — orchestrating session: write `docs/COST-BASELINE.md`

Replace the stub with, at minimum:

```markdown
# Cost baseline

## Methodology
- Fixed scenario: the two real cases in `evals/` — `spec-creator` quality
  case (dark-mode-toggle fixture) and the `AC-9` negative case.
- 3 repeats per case, before and after.
- Model: <EVAL_MODEL value from evals/src/config.ts>, held constant.
- Before commit: <SHA>. After: <SHA or "dirty tree at <SHA>">.
- Optimization: removed duplicated diff-artifact-reuse explanation from
  `plan-verifier.md` and `architecture-reviewer.md`, replaced with a
  pointer to `run-plan/SKILL.md`'s existing full explanation. Neither the
  model nor any routing/dispatch logic changed — only prompt text length.

## Before
| Case | median tokens (in/out) | median tool calls | median latency | pass rate | critical failures |
|---|---|---|---|---|---|
| spec-creator (dark-mode) | ... | ... | ... | ... | ... |
| AC-9 negative | ... | ... | ... | ... | ... |

## After
(same table shape)

## Result
State plainly whether the optimization is accepted (quality gate green +
measurable cost/latency win) or "within noise" — per the confirmed
invariant, never report an invented saving. Since neither eval case's
prompt actually *invokes* `plan-verifier.md`/`architecture-reviewer.md`
(the two real cases are `spec-creator` and the `AC-9` negative activation
check, neither of which dispatches those two agents), the honest
expectation going in is that this specific baseline shows **no
measurable delta at all** for the trimmed files — call this out explicitly
rather than searching for a spurious improvement; the real value of the
trim is prompt-length/maintenance hygiene for whichever future case
exercises `run-plan`'s review loop (checklist items 3-5, currently
structural-only), not this phase's two real cases. If the numbers do move
outside noise anyway, report that honestly too, but don't manufacture an
explanation that isn't supported by what the two real cases actually
exercise.
```

## Test plan

- `cd evals && npm run eval:agents` — before and after, 3× each (Step 1,
  Step 5). Pass = the one case's `outcome: true`, threshold 0.6, as
  already established in Phase 4.
- `cd evals && npx vitest run workflow -t "does not activate on an
  unrelated prompt (AC-9)"` — before and after, 3× each. Pass = `outcome:
  true` (activation check).
- `claude plugin validate ./plugins/sdd-engineering` and
  `claude plugin validate ./plugins/architecture-review` — must report no
  schema errors after Step 2's edit (Step 4).
- Manual grep self-check (Step 2.4) — the diff-artifact-reuse explanation
  appears in full in exactly one file (`run-plan/SKILL.md`) after the trim.

## Out of scope

Architecture review and security review of the edited files are **not**
part of this plan or the implementer's job — if either edited file's
change is significant enough to warrant it, that runs as a separate
review pass, in either execution mode. This phase also does not: touch
`evals/src/**` or fixture files (constraint above), populate any
`plugins/<name>/evals/` (still intentionally empty per
`evals/README.md:34-38`), wire `validate.yml` CI (deferred, same as
Phase 4), or release/tag either plugin (Step 9 of the lab, a later phase).
