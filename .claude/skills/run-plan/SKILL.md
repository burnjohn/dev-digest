---
name: run-plan
description: "Executes an existing `docs/plans/NN-slug.md` end to end — dispatches every wave's task
  blocks to `implementer`, then drives the review→fix→re-review loop until the architecture verdict
  clears or a round cap stops it. Use when the plan already exists and the owner says 'run plan 06',
  'implement this plan', 'execute the plan', 'run the waves', 'drive the plan to done',
  'запусти план', 'імплементуй план'. Reads the plan, extracts each task block verbatim, checks wave
  disjointness, triages coverage for free before paying for a review, converts every CRITICAL and
  MAJOR finding into a `FIX-n` block, re-reviews only the fixed paths, then runs `plan-verifier`
  last. Never writes a spec and never writes a plan — `spec-creator` and `implementation-planner`
  run before this and are not part of it. Never commits, never pushes, never runs `pr-self-review`."
metadata:
  version: "1.0.0"
---

# run-plan

Answers exactly one question: **has this plan actually landed?**

Not *what should we build* — that is `spec-creator`. Not *how should we build it* — that is
`implementation-planner`. Both run **before** this skill, by hand, and neither is dispatched from
here. This skill takes a finished `docs/plans/NN-slug.md` as input and drives it to a reviewed,
verified state.

**Why it exists.** The agent set and the artifact chain are complete, but nothing drives them. Every
wave dispatch, every fix block, every re-review is hand-typed. The loop is already specified in
[`docs/plans/README.md`](../../../docs/plans/README.md) §"After the waves land" and §"Remediation" —
this skill executes that specification instead of restating it. The part the owner does most often
by hand, and the part this skill exists for, is **§8: the review→fix→re-review iteration.**

**Reference files** — read on demand, not up front:
- `references/fix-round.md` — the `FIX-n` round protocol: building blocks from findings, the
  disjointness check, the regression guard, and what is never fixed.

---

## 1. Scope

**In scope:** one plan file, its waves, the remediation of what the reviewers find, and a report.

**Out of scope, hand these off:**

| Ask | Goes to |
|---|---|
| Write the specification | `spec-creator` — run it first, by hand |
| Write or re-cut the plan | `implementation-planner` — run it first, by hand |
| Decide whether this may be pushed | `pr-self-review` — the owner's, run once, by hand |
| Line-level bug hunting | built-in `/code-review` |
| Vulnerability hunting | the `security` skill / built-in `security-review` |
| Commit, stage, push, merge | **the owner.** No exceptions, at any point. |

**Invocation:**

```
/run-plan [<plan-path>] [flags]
```

The positional argument is a path to `docs/plans/NN-slug.md`. Omitted, resolve the
highest-numbered plan whose `Status:` is `draft` or `in-progress`, and **name it back to the owner
before doing anything else** — never guess silently.

**Flags** — read them out of the invocation text, the prose convention `pr-self-review` established.
Everything after the skill name arrives as one string: the first path-shaped token is the plan, the
rest are flags. Unrecognized flags are reported back, never silently ignored.

| Flag | Effect |
|---|---|
| `--wave N` | Resume at wave N. Earlier waves are assumed landed; say so in the cost plan. |
| `--only T3,T5` | Dispatch exactly these tasks and skip the wave walk. Still runs §8. |
| `--rounds N` | Cap on architecture fix rounds. Default **2**. |
| `--single` | Sequential — one implementer at a time, no fan-out. |
| `--tests` | Enable `test-writer` at triage-flagged gaps. **Off by default.** |
| `--no-verify` | Skip `plan-verifier`. Required for the short leg — an inline block with no plan. |
| `--notes "<text>"` | Extra owner context, passed to implementers as a non-scope-bearing addendum. |
| `--design <path…>` | Design files, passed the same way. |

---

## 2. Phases

Eight phases. Subagents run in 2, 4, 5 and 6 — nowhere else.

| Phase | Mode | Does | Cost |
|---|---|---|---|
| 0 | inline | resolve the plan, read `INSIGHTS.md`, run gates `G1`–`G5` | free |
| 1 | inline | print the cost plan; the owner may cancel | free |
| 2 | **parallel** | one `implementer` per task, wave by wave | the bulk |
| 3 | inline | coverage triage against §6 | free |
| 4 | **loop** | `architecture-reviewer` → `FIX-n` → re-review, capped | the iteration |
| 5 | parallel | `test-writer`, **only** with `--tests` | off by default |
| 6 | inline | `plan-verifier`, then at most one remediation round | one call |
| 7 | inline | report and hand back to the owner | free |

Phase 0 is deliberately free and deliberately first: a malformed plan or a colliding owned path
costs nothing to catch here and costs a whole wave of lost work to catch later.

### Models

| Agent | Model | How |
|---|---|---|
| `implementer` | sonnet | its own frontmatter — pass **no** override |
| `test-writer` | sonnet | its own frontmatter — pass **no** override |
| `architecture-reviewer` | **sonnet** | explicit `model: "sonnet"` on **every** dispatch |
| `plan-verifier` | **sonnet** | explicit `model: "sonnet"` on **every** dispatch |

**State this divergence in the cost plan, every run.** `.claude/agents/architecture-reviewer.md` and
`.claude/agents/plan-verifier.md` both still say `model: opus` on disk, deliberately: those files
are Tier A and editing them takes effect only after a session restart. The override lives here
instead, which means it applies **only** under `/run-plan` — a manual dispatch of either agent still
costs Opus. Anyone reading the agent file and expecting Opus is right about the file and wrong about
this skill, so the cost plan says which model actually ran.

---

## 3. Hard rules

1. **Never run `spec-creator` or `implementation-planner`.** No plan and no inline block is `G1`, a
   stop — not a licence to improvise one.
2. **Never commit, stage, push, checkout, or run `pr-self-review`.** Git state is the owner's call
   at every point in this workflow. So is `db:migrate`, `db:seed`, and a `client/` build.
3. **Never edit a Tier A path** — any `INSIGHTS.md`, `AGENTS.md`, `CLAUDE.md`,
   `.claude/settings*.json`, `.claude/hooks/**`, an existing `.claude/agents/*.md` or
   `.claude/skills/**/SKILL.md`, a lockfile, `server/src/db/migrations/**`,
   `client/src/vendor/shared/**`, an existing file under `server/src/vendor/shared/contracts/**`, a
   root config, or `docs/plans/README.md`. Each becomes a `[parent session]` step in the report,
   naming the **replacement action**, not the file.
4. **Never add a requirement.** `--notes` and `--design` may *clarify* a `REQ`; they may never
   *add* one. Adding one breaks the `AC`→`REQ`→task→acceptance chain the whole method rests on.
   Material that adds scope fires `G4` and goes back to `implementation-planner`.
5. **Never dispatch the plan file.** Always the extracted block. A plan runs 21k–44k tokens and a
   block about 2k; dispatching the file makes each agent pay the whole plan to read 5% of it.
6. **Never invent a done-condition command.** Copy it from the task block, which copied it from
   `docs/plans/README.md`. In the `process` lane the value is `n/a`, and `n/a` means a *different*
   check — an acceptance box closed by **quoting the file content** that satisfies it — not no check.
7. **Never translate a verdict vocabulary.** `architecture-reviewer` speaks `BLOCK`/`CHANGES`/`PASS`,
   `plan-verifier` speaks `VERIFIED`/`PARTIAL`/`NOT IMPLEMENTED`/`CANNOT VERIFY` rolling up to
   `COMPLETE`/`INCOMPLETE`, and `pr-self-review` speaks `request_changes`/`comment`/`approve`. They
   are deliberately different and none gates another. This skill's own roll-up is a fourth
   vocabulary — §11 — for the same reason.
8. **A finding not fixed is recorded with the reason.** An unfixed `CRITICAL` nobody wrote down
   reads exactly like one nobody found.

---

## 4. Phase 0 — resolve and gate

Inline, free, no dispatch. In order:

1. Resolve the plan path. Read its header (`Modules:`, `Created:`, `Status:`, `Spec:`), §2
   Requirements, §6 Task graph, §7 Tasks, §8 Done condition, §9 Risks.
2. Read **every touched module's `INSIGHTS.md`** and summarize the most relevant points before any
   dispatch. This is the root `AGENTS.md` session protocol and it is not discharged by the plan's §3
   — an entry appended *after* the plan's `Created:` date **beats the plan**, and this is the pass
   that finds it.
3. Record the git baseline: `git --no-pager -c core.quotepath=false rev-parse HEAD` and the current
   branch. Report only — never change either.
4. Run the gates.

| Gate | Fires when | Do |
|---|---|---|
| **G1** | No plan file resolved and no inline task block supplied | Stop. Send the owner to `implementation-planner`. Do not improvise a plan. |
| **G2** | Plan malformed — no §2 `REQ` table, no §6 coverage matrix, or a task block missing a mandatory field | Stop. **Name the field.** `Binding insights: none` is valid; an empty field is not. `Wave:`/`Depends on:` may read `n/a`; **`Parallel:` may not** — it gates the Tier B rule. |
| **G3** | Two tasks in the same wave name the same `Owned paths` entry | Stop. Name the collision and both tasks. There is no worktree isolation: a violation is **silent lost work**, not a merge conflict — whichever agent writes second overwrites the first. |
| **G4** | `--notes`/`--design` describe behaviour no `REQ` covers | Stop. Quote the passage and the scope it adds. Back to `implementation-planner`. |
| **G5** | A Tier A path appears in a task's `Owned paths` | Strip it, record a `[parent session]` step with the replacement action, continue with the rest of the task. |

Gates `G1`–`G4` stop the run with **zero agent dispatches**. Report which fired and why; do not
partially proceed.

A task owning a **Tier B** path (`.claude/agents/README.md`, `.claude/skills/README.md`) must be
alone in its wave and must say `**Parallel:** no`. If it does not, that is `G2`.

---

## 5. Phase 1 — the cost plan

Print it, then let the owner cancel. A driver that quietly spends twenty agent calls is a driver the
owner disables.

~~~markdown
**Plan:** `docs/plans/06-blast-radius.md` — 21 REQ · 8 tasks · 3 waves · Created 2026-08-23
**Baseline:** `main` @ `b4baf20`
**Waves:** W0 → T1 (solo) · W1 → T2, T3, T4 (parallel) · W2 → T5…T8 (parallel)
**Concurrency:** 5 max · **Models:** implementer=sonnet · architecture-reviewer=**sonnet
(override — the agent file says opus)** · plan-verifier=**sonnet (override)**
**Fix rounds:** cap 2 · **test-writer:** disabled (pass `--tests` to enable)
**Estimated dispatches:** 8 implementers + 1–3 reviews + 0–4 fixes + 1 verify
~~~

Then stop and wait. `--wave`/`--only` change the task list; say which tasks are being skipped and on
what assumption.

---

## 6. Phase 2 — the waves

For each wave, in §6 order:

1. **Extract each task block verbatim.** Headings are `^### T<n> —`; the extraction is mechanical.
   Change nothing inside the block.
2. **Add two lines the plan file supplies implicitly:**
   - `**Dispatched:** YYYY-MM-DD` carrying the plan's **own `Created:` value — not today's date.**
     That field is what the insight conflict rule keys on. Omit it and the implementer treats every
     `INSIGHTS.md` entry as newer than the task.
   - `Task source: T<n> of docs/plans/NN-slug.md, reproduced verbatim below — do not open the plan
     unless a mandatory field is missing from this block.`
3. **Append the owner addendum**, if `--notes`/`--design` were supplied, under exactly this heading
   so it can never be mistaken for scope:

   ~~~markdown
   **Owner context (clarifies the task; adds no requirement — if it seems to, stop and report):**
   - <the note, verbatim>
   - Design: `<path>`
   ~~~
4. **Dispatch every task in the wave in one message**, max 5 concurrent, `implementer`, no model
   override. With `--single`, one at a time in `Depends on:` order.
5. **Collect the reports** — `DONE` | `BLOCKED` | `PARTIAL` — and integrate **between** waves, never
   inside one. Expect reports that are green-in-lane and red overall while a wave is running: a
   typecheck spans the whole package and surfaces siblings' in-flight edits. Errors outside a task's
   owned paths are *sibling in-flight*, not that task's to fix.
6. **A `BLOCKED` task stops its dependents.** Report and stop rather than dispatching wave N+1 onto
   a base that is missing wave N's contract. A `BLOCKED` task with no dependents does not stop the
   run — record it and carry on.

---

## 7. Phase 3 — coverage triage

Inline, free, and **before** anything paid. The session holds every implementer report and §6 is on
disk. Cross them and emit three lists:

- **Claimed** — every `REQ` in the §6 matrix hit by at least one report whose verdict is `DONE`.
- **Open** — any `REQ` whose only claim comes from a `BLOCKED`/`PARTIAL` report, or from a report
  with an unticked acceptance box.
- **Untested** — targets that landed with no test file in their `Owned paths`. This list is the
  **only** input to phase 5, and it is reported even when `--tests` is off.

Also action or record every `Notes for the integrator` entry. Finding a requirement nobody
implemented *after* paying for a structural review is precisely the failure this step prevents.

---

## 8. Phase 4 — the architecture review loop

The iteration this skill exists for. Read `references/fix-round.md` before the first fix dispatch.

**Round 1.** Dispatch `architecture-reviewer` with `model: "sonnet"`. The target is the **union of
every `Owned paths` entry across the tasks actually dispatched** — *not* `git diff`. Two reasons:
the scope is deterministic and reproducible across rounds, and unrelated working-tree noise cannot
pollute the review.

Parse the reply's `**Verdict:**` line (`BLOCK` | `CHANGES` | `PASS`) and its findings table, then
triage every row:

| Row | Action |
|---|---|
| `CRITICAL` | becomes a `FIX-n` block |
| `MAJOR` | becomes a `FIX-n` block |
| `MINOR` | recorded, not fixed — it does not enter the verdict |
| marked `[pre-existing]` | never fixed by this loop; recorded. It is already excluded from the reviewer's own gating count |
| anything in `### Advisory` | never fixed — the reviewer itself marks it ungrounded |
| on a **Tier A** path | `[parent session]` step, never dispatched |
| whose fix would add scope no `REQ` covers | recorded with the reason, escalated to the owner, not fixed |

`PASS` → leave the loop.

Otherwise build the `FIX-n` blocks from the template in `references/fix-round.md`, **verify their
`Owned paths` are disjoint** — a fix set fanned out together is a wave, and there is no §6 to record
the check in — and dispatch `implementer` for each, max 5 concurrent.

**Rounds 2..N.** Re-dispatch `architecture-reviewer` scoped to **only the `FIX` blocks' owned
paths**, not the whole surface again. Everything else already passed and re-reading it buys nothing.
This is the loop's main token saver: round 2 costs a fraction of round 1.

Exit conditions, checked in this order:

1. Verdict is `PASS` → done, continue to phase 5.
2. **Regression guard** — this round reports a `CRITICAL` at a `file:line` the previous round did
   not → **stop the loop immediately**, report both findings side by side. A fix that broke
   something is worse than the finding it closed, and another automatic round will not un-break it.
3. Round counter has reached the `--rounds` cap (default 2) with a `CRITICAL` still open → **`G6`**.
   Stop. Print every open finding **verbatim** — severity, `file:line`, and the violated rule as the
   reviewer quoted it — and hand to the owner. Never loop silently past the cap.

---

## 9. Phase 5 — `test-writer`

**Skipped entirely unless `--tests` is passed.** When skipped, say so in the report and list phase
3's `Untested` targets so the gap is visible rather than absent.

With `--tests`: dispatch **only** at the targets phase 3 flagged, never at a target that already has
a test. It is a gap-filler, not a phase — every implementer already writes its lane's tests, and
`test-writer`'s RED proof temporarily mutates the file under test. On the dirty tree the
implementers leave behind, that mutation cannot be undone with git; it is restored from bytes held
in the agent's own context. A half-mutated source file on disk is the worst outcome available
anywhere in this agent set, so every unnecessary target is one more walk down that path for nothing.

---

## 10. Phase 6 — `plan-verifier`

Skipped with `--no-verify`, which is **required** for the short leg — an inline task block with no
plan file has no §6 matrix to walk, so there is nothing for this agent to do.

Otherwise dispatch it once, with `model: "sonnet"`, and **last**. It has to be last: its contract
caps code inspection at `PARTIAL`, so only a passing test buys `VERIFIED`. Run before phase 5 it
grades every uncovered requirement `PARTIAL` and returns `INCOMPLETE` by construction.

Parse the four-value vocabulary per row and the `COMPLETE`/`INCOMPLETE` roll-up. Then:

- `NOT IMPLEMENTED` for a `REQ` → a `FIX-n` block, one round, then re-run `plan-verifier` once.
- `PARTIAL` → **not** a fix block. It means "implemented, not proven by a test". Record it; with
  `--tests` it was already phase 5's input, and without it, it is a reported gap.
- `CANNOT VERIFY` → record the blocker it named. If the blocker is environmental (Docker down, a
  missing migration), that is a `[parent session]` step, not a code fix.
- **An `AC` in the spec cited by no `REQ`** → **never** a fix block. It is a scope gap that belongs
  to `implementation-planner`, and this skill may not invent the missing requirement. Quote the `AC`
  verbatim and escalate.

After the single remediation round, stop regardless of the verdict. Two verifier rounds is the cap.

**Expect `INCOMPLETE` without `--tests`, and say why in one line** rather than presenting it as
failure: inspection alone never buys `VERIFIED`, so every untested `REQ` grades `PARTIAL` and any
`PARTIAL` makes the roll-up `INCOMPLETE`.

---

## 11. Phase 7 — output format

The roll-up uses **three values of its own** — `LANDED` · `LANDED WITH GAPS` · `STOPPED` —
deliberately not `architecture-reviewer`'s and not `pr-self-review`'s. The repo already keeps those
two vocabularies apart; a third consumer must not blur them.

- `LANDED` — every task `DONE`, architecture `PASS`, verifier `COMPLETE`.
- `LANDED WITH GAPS` — the code is in and reviewed, but something is recorded and unclosed: a
  `PARTIAL`, a `MINOR`, a `[parent session]` step, a skipped verification.
- `STOPPED` — a gate fired, a wave `BLOCKED`, `G6`, or the regression guard tripped.

The report is the whole reply. Its first character is the `#` of the opening heading.

~~~markdown
# Plan Run — <plan title>
**Plan:** `docs/plans/NN-slug.md` · **Spec:** `<pkg>/specs/SPEC-NN-<slug>.md` | none
**Result:** LANDED | LANDED WITH GAPS | STOPPED
**Gate:** <G1–G6 — the one that fired; omit the line when none did>
**Baseline:** `<branch>` @ `<sha>` — working tree left dirty and uncommitted, by design
**Flags:** <as given, or "none">

## Waves
| Wave | Task | Lane | Verdict | Files changed |
|---|---|---|---|---|
| 0 | T1 | contract | DONE | 2 |

## Coverage (phase 3, against §6)
**Claimed:** REQ-1…REQ-19 · **Open:** REQ-20 (T7 PARTIAL) · **Untested:** `server/src/x/service.ts`

## Architecture rounds
| Round | Scope | Verdict | CRITICAL | MAJOR | Fixed | Remaining |
|---|---|---|---|---|---|---|
| 1 | 14 owned paths | BLOCK | 1 | 2 | FIX-1, FIX-2, FIX-3 | — |
| 2 | 3 fixed paths | PASS | 0 | 0 | — | 2 MINOR (recorded below) |

## Plan verification
**Verdict:** COMPLETE | INCOMPLETE — <n> VERIFIED · <p> PARTIAL · <ni> NOT IMPLEMENTED · <cv> CANNOT VERIFY
<one line on why, when INCOMPLETE was expected>

## Recorded, not fixed
| Finding | Severity | Why not fixed |
|---|---|---|
| `client/src/x.tsx:8` — <rule> | MINOR | does not enter the verdict |

## `[parent session]` follow-ups
- <Tier A action, named as the action and not the file>

<or "None.">

## Not run by this skill
`pr-self-review`, the commit, the push, and the end-of-session `INSIGHTS.md` append are the
owner's. Nothing here has been staged or committed.
~~~

That closing section is fixed text and is never omitted, including on `STOPPED`.

---

## 12. Subagent contract

What each dispatch carries, and nothing more:

| Agent | Receives | Model | Returns |
|---|---|---|---|
| `implementer` | one extracted task block + `Dispatched:` + provenance line + optional owner addendum | inherit | `DONE`/`BLOCKED`/`PARTIAL`, files changed, acceptance ticked, verbatim final-proof output |
| `implementer` (fix) | one `FIX-n` block built per `references/fix-round.md` | inherit | same |
| `architecture-reviewer` | an explicit path list, plus "structure only" | `"sonnet"` | `BLOCK`/`CHANGES`/`PASS` + findings table |
| `test-writer` | one flagged target, its lane | inherit | `DONE`/`BLOCKED` + RED-then-GREEN |
| `plan-verifier` | the plan path — this is the one agent that **should** read the whole plan | `"sonnet"` | `COMPLETE`/`INCOMPLETE` + per-`REQ` matrix |

No agent dispatched from here spawns another: `implementer`, `architecture-reviewer`,
`plan-verifier` and `test-writer` all lack the `Agent` tool, which is what keeps this a tree.
