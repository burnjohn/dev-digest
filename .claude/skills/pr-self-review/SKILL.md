---
name: pr-self-review
description: "Reviews all local changes before a pull request is opened, and blocks the PR if a verified CRITICAL finding exists. Routes the diff to DevDigest's other skills by zone — UI skills onto UI files, backend architecture skills onto backend files — runs the real toolchain (typecheck, lint, tests, contract sync) first, verifies every critical finding adversarially, and writes a sha-bound verdict that scripts/pr-gate.sh enforces on `gh pr create`. Use when the user says 'review my changes', 'self review', 'check before PR', 'am I ready to open a PR', 'pre-PR check', 'pr self review', or is about to run `gh pr create` / `gh pr merge`. Not a replacement for human review — see 'What this does not check'."
version: 1.0.0
---

# PR Self Review

A gate between "I finished the change" and "I opened the PR". It owns no review
rules of its own: it decides **which existing skill looks at which file**, runs
the toolchain CI would run, and turns the result into a verdict that can block
`gh pr create`.

Companion files, read them when the step says to:

| File                | What it holds                                          |
| ------------------- | ------------------------------------------------------ |
| `routing.md`        | changed files → zones → skills                         |
| `conventions.md`    | Stage A: toolchain + deterministic convention checks    |
| `report-format.md`  | verdict JSON, terminal summary, PR body draft          |

## Vocabulary — reused, not invented

`Severity` (`CRITICAL` / `WARNING` / `SUGGESTION`), `Finding` and the
`ci_fail_on: 'critical'` gate policy come from
[`@devdigest/shared`](../../../server/src/vendor/shared/contracts/findings.ts).
Local review and the CI gate therefore return the same verdict on the same diff.
Do not introduce a parallel severity scale.

---

## Step 1 — Collect the diff

Baseline is the merge-base with `main`, plus everything uncommitted, because the
point is to run *before* the PR exists.

```bash
BASE=$(git merge-base main HEAD)
git diff "$BASE"...HEAD --name-status   # committed on this branch
git diff HEAD --name-status             # unstaged
git diff --cached --name-status         # staged
git ls-files --others --exclude-standard  # new files
```

Exclude before anything else: `server/clones/**`, `**/node_modules/**`,
`pnpm-lock.yaml`, `package-lock.json`, `*.tsbuildinfo`.

Work in **hunks, not files**. A pre-existing problem outside the changed lines is
at most a `SUGGESTION` and never blocks — otherwise the first run on any legacy
file stops everything, and the gate gets switched off within a week.

Edge cases, all of which must produce a clear message rather than a silent
`PASS`:

- **Empty diff** → `PASS`, no subagents, exit.
- **No `main` / detached HEAD** → error out, do not write a verdict.
- **Merge commits from `main`** → excluded; reviewing merged-in code is noise.
- **Pure renames (`R100`)** → skipped.
- **Diff over budget** (>60 files or >4000 changed lines) → review by zone in
  descending risk order (`server` → `reviewer-core` → `client` → `e2e`), and set
  `truncated` in the verdict naming exactly what was left out.

## Step 2 — Resolve zones and skills

Read `routing.md`. Re-read `.github/workflows/*.yml` and prefer them if they
disagree with the cached zone table. Produce, for each skill: the slice of hunks
it will see, or the reason it is being skipped.

## Step 3 — Stage A: deterministic checks

Read `conventions.md` and run it. Toolchain first (`check-contracts.sh` always,
then the activated zones), then the path/content convention rules, then the
router self-audit.

**If Stage A yields a CRITICAL, stop here.** Report it and skip the LLM fan-out
entirely. A failing typecheck makes every skill review downstream of it
unreliable, and the author has to come back anyway. This is the single biggest
cost saving in the pipeline.

Stage A findings are `verified` by construction and skip Step 6.

## Step 4 — Cache lookup

Key: `sha256(hunk_text) + skill_name + skill_version`, stored under
`.claude/pr-review/cache/`. Reuse findings for unchanged hunks.

The dominant usage pattern is not one run — it is *run → BLOCKED → fix one file
→ run again*. Without the cache the second pass costs as much as the first, and
that is the pass where patience runs out.

## Step 5 — Stage B: skill fan-out

One subagent per (skill × zone slice), **all launched in parallel in a single
message**. Each subagent is told to:

1. Load its skill via the Skill tool and apply only that skill's rules.
2. Review only the hunks it was given; the full file contents are context, not
   scope.
3. Return `Finding[]` matching `report-format.md`, with `source` set to its own
   skill name.
4. Return an empty array when it finds nothing. "Nothing to report" is a valid,
   expected outcome — never pad.

Also give each subagent the current `.claude/pr-review/false-positives.md`
(Step 9) filtered to its own skill, so it stops repeating rejected findings.

## Step 6 — Stages C–E: ground, dedupe, verify

**C — Grounding.** Drop any finding whose `file` is not in the diff, or whose
`[start_line, end_line]` intersects no changed hunk. Mirrors `reviewer-core`'s
citation-grounding gate.

**D — Dedupe.** Key `file:start_line:category`. Several skills legitimately catch
the same thing; keep the highest `confidence`, merge the other rationales into it.

**E — Adversarial verification of every CRITICAL candidate.** Spawn 2 independent
subagents per candidate, each instructed to **refute** it, defaulting to
"refuted" under uncertainty. Both uphold → stays `CRITICAL` with
`verified: {attempts: 2, upheld: 2}`. Otherwise it is downgraded to `WARNING`
with the refutation recorded in `rationale`.

A `security` finding is eligible for `CRITICAL` only at that skill's **HIGH**
confidence tier. Stage A findings skip this step.

The asymmetry is deliberate: a wrong block costs far more than a missed warning,
because it is what teaches people to reach for `PR_SELF_REVIEW_SKIP=1`.

## Step 7 — Verdict

`BLOCKED` iff at least one `CRITICAL` survives. Otherwise `PASS`.

Write `.claude/pr-review/<sha>.json` per `report-format.md`, taking
`worktree_hash` from:

```bash
./scripts/pr-gate.sh --worktree-hash
```

Never compute that hash yourself — the gate recomputes it, and the two must
agree exactly.

## Step 8 — Report and PR draft

Print the terminal summary from `report-format.md`. Always include the
`Skipped`, `Suppressed` and (if set) `truncated` lines.

On `PASS`, also write `.claude/pr-review/<sha>.pr.md` — a PR body draft. The
analysed diff is already in hand, so it costs one extra call, and it is what
turns the gate from a tax into something people run voluntarily.

## Step 9 — Record rejections

When the user dismisses a finding as wrong, append to
`.claude/pr-review/false-positives.md`:

```markdown
- **[skill] rule/title** — `path/to/file.ts`
  Rejected 2026-08-14. Why it is not a problem: <one line>
```

Step 5 feeds this back in. A reviewer that repeats a rejected finding every run
gets ignored, and then bypassed.

---

## Enforcement

`scripts/pr-gate.sh` is wired as a `PreToolUse` hook on `Bash` in
`.claude/settings.json`. It intercepts `gh pr create`, `gh pr ready` and
`gh pr merge` and denies them unless a verdict exists for the current `sha` **and**
`worktree_hash`, with `verdict: "PASS"`.

`git push` is deliberately **not** intercepted — pushing a branch is not opening
a PR, and blocking it makes the gate hostile for normal WIP.

Override: `PR_SELF_REVIEW_SKIP=1 gh pr create …`. The escape hatch is mandatory.
A gate with no override is one that gets deleted the first time it is wrong at
23:00, and then nothing is left.

---

## What this does not check

State this whenever reporting a `PASS`. `PASS` means "none of the things we know
how to look for were found" — not "this code is correct".

- Logic bugs in business rules that read as plausible code.
- Anything outside the changed hunks.
- Performance under load; correctness under concurrency.
- Integration behaviour — `*.it.test.ts` and `e2e/` are deferred to CI.
- Whether the change is the *right* change. That is human review, and this skill
  does not substitute for it.

---

## After the run

Per the root `CLAUDE.md`, finish a non-trivial run with the
`engineering-insights` skill. This one spans every package, so anything learned
belongs in the **root** `INSIGHTS.md`.
