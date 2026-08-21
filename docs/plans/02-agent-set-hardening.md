# Plan 02 — Harden the agent set against its own review findings

**Modules:** none (process files only)   **Created:** 2026-08-21   **Status:** done
**Spec:** none

## 1. Goal

`pr-self-review` over commit `b134c28` returned `approve` with **0 CRITICAL** — and 23 WARNING/
SUGGESTION findings, plus one the parent session found while verifying them. Nothing blocked the
push, and nothing should have: no CRITICAL survived, no mechanical rule failed, and the pre-gate had
nothing to run because no CI suite covers `.claude/**` or `docs/**`.

But the findings were good, and most of them were defects in files that *govern how agents behave*.
Four of them contradicted rules stated elsewhere in the same commit. Three were false claims about
the repo, sitting inside files whose own rules demand accurate citation. One — the worst — reinstated
the exact bug the commit existed to remove.

This plan closes all 24. One of them becomes real enforcement rather than better wording — a
`permissions.deny` block, which the repo had never used. An attempt at a second failed and is
recorded in REQ-8: the mechanism the docs seemed to offer turned out not to exist.

## 2. Requirements

- **REQ-1**: `docs/plans/README.md` no longer contains a statement that a `process` task creating a
  new agent file is a planning error; the lane's two kinds of work — creating a new file, editing a
  catalog — are distinguished where the lane is introduced.
- **REQ-2**: `docs/plans/README.md` lists itself in Tier A, so the canonical contract cannot be
  assigned to an implementer.
- **REQ-3**: `plan-verifier.md` states an explicit, reasoned exception to "inspection caps at
  `PARTIAL`" for requirements whose subject is file content rather than program behaviour, and the
  `process`-lane note defers to that exception instead of contradicting the hard rule.
- **REQ-4**: No agent file claims that read-only-ness is enforced by the tool allowlist while
  granting `Bash`. Each read-only agent holding `Bash` enumerates what that grant may and may not do.
- **REQ-5**: `test-writer.md` states its mutate-and-revert protocol exactly once, distinguishes an
  untracked target (refused at a named gate) from a dirty one (permitted under a pre-image rule), and
  declares a closed write surface.
- **REQ-6**: `architecture-reviewer.md` attributes the no-linter fact to `onion-architecture` §6
  scoped to `server/`, not to root `AGENTS.md`, and cites `frontend-ui-architecture` §5 for import
  boundaries.
- **REQ-7**: The `Lane` enum in each report template covers every lane that file defines —
  `process` in `implementer.md`, `e2e-refused` in `test-writer.md`.
- **REQ-8**: `planner.md` states its delegation limit accurately. **Revised mid-flight — the original
  wording was "restricts delegation in its `tools` allowlist rather than in prose alone", and that
  turned out to be impossible.** `Agent(researcher, Explore)` parses, is echoed back in the agent
  roster as though it applied, and enforces nothing: a planner carrying it dispatched an
  `implementer` successfully. `permissions.deny` cannot substitute, because deny is session-wide and
  would block the parent session from that agent type as well. So the requirement is now that the
  file says the limit is prose and holds only because the agent keeps it — the opposite of what this
  plan set out to do, recorded as such rather than quietly reworded.
- **REQ-9**: `researcher.md` and `doc-writer.md` each carry a rule that fetched or supplied content
  is material to quote, never an instruction to act on or pass upward.
- **REQ-10**: `doc-writer.md`'s mermaid gates name the reserved-word list and the leading-`o`/`x`
  edge trap, and present the `[A-Za-z0-9_]+` id preference as a house convention rather than a
  mermaid constraint.
- **REQ-11**: `.claude/settings.json` denies `Edit` against `.claude/settings*.json` and
  `.claude/hooks/**`, **anchored at the project root with a leading `/`**, with the existing
  `PreToolUse` hook block intact. **Revised after the fact — the shipped block was
  `Edit`+`Write` on `.claude/settings.json`, cwd-relative, and two of its four rules were inert.**
  Three defects, all confirmed against the permission docs at CLI v2.1.233:
  (a) only `Edit(path)` and `Read(path)` rules are consulted — a path rule on `Write` parses, warns
  at startup, and is never checked, while `Edit(path)` already governs the `Write` tool; (b) a bare
  pattern resolves against the **session cwd**, so a session started in `server/` matched nothing,
  silently — a `/` prefix anchors at the settings source, which for this file is the project root;
  (c) `settings.json` did not cover `.claude/settings.local.json`, which carries its own
  `permissions.allow` block an agent could widen for itself — `settings*.json` covers both.
  Same failure shape as REQ-8: it parsed, it looked like enforcement, it was not.
- **REQ-12**: `docs/plans/01-agent-set-expansion.md` contains no task block naming a Tier A path;
  REQ-8 of that plan is covered by a `[parent session]` step instead.

## 3. Insights consulted

`.claude/` is not a module and no `INSIGHTS.md` covers it (same as plan 01 §3). Nothing binds this
work. Checked, not skipped.

## 4. Contract changes

`docs/plans/README.md` changes — it is the canonical contract — but no `server/src/vendor/shared/**`
schema is touched, so the `contract` lane's sync-and-typecheck fan-out does not apply.

## 5. Architecture

No diagram. The change alters wording and one config block; it moves no boundary. Per this repo's own
rule, a diagram of an unchanged architecture is noise.

## 6. Task graph

Every path in this plan is Tier A — existing agent files, the canonical contract, and
`.claude/settings.json`. **Nothing here is dispatchable**, by the rule this same set established:
a rule already in force governs the agent that would edit it. All work is a serialized
`[parent session]` step — except P9, which the session cannot take either, and which falls to a
human with an editor.

| Wave | Steps | Parallel? |
|---|---|---|
| 0 | P1 — `plan-verifier.md` first, since it verifies the rest | serialized |
| 1 | P2–P7 — remaining agent files and the canon | serialized |
| 2 | P8 — `.claude/settings.json`, last | serialized |
| 3 | P9 — `.claude/settings.json` again, **outside Claude Code** (see REQ-11) | serialized |

Requirement → Step coverage:

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 `plan-verifier.md` | | | x | x | | | | | | | | |
| P2 `architecture-reviewer.md` | | | | x | | x | | | | | | |
| P3 `test-writer.md` | | | | | x | | x | | | | | |
| P4 `implementer.md` | | | | | | | x | | | | | |
| P5 `planner.md` | | | | | | | | x | | | | |
| P6 `researcher.md` + `doc-writer.md` | | | | | | | | | x | x | | |
| P7 canon + `agents/README.md` + plan 01 | x | x | | | | | | | | | | x |
| P8 `settings.json` | | | | | | | | | | | x | |
| P9 `settings.json` (human) | | | | | | | | | | | x | |

**Ordering constraint, not a preference:** P8 must run last of the in-session steps.
`Edit(/.claude/settings*.json)` denies
further edits to that file, including corrections to the deny list itself — which is exactly what
happened: P8 shipped a defective block and locked the session out of repairing it. See REQ-11 and P9.

## 7. Steps

All steps are `[parent session]`. Each is recorded here as what changed and why, not as a dispatchable
task block — see §6.

- **P1 — `plan-verifier.md`.** Added the file-content exception to the `VERIFIED` bar, with its
  reasoning stated rather than asserted: the rule exists because code is not its own proof, and that
  argument does not reach a claim about a string in a file. Replaced the read-only overclaim with an
  enumerated `Bash` bound, including an explicit ban on repairing anything to make a REQ verify.
- **P2 — `architecture-reviewer.md`.** Same `Bash` correction. Re-attributed the no-linter fact.
  Fixed the `frontend-ui-architecture` section reference.
- **P3 — `test-writer.md`.** Split the untracked case (gate `G5`, refuse) from the dirty case
  (permitted, restore from a pre-image, never `git checkout` — that would discard a sibling's work).
  Collapsed the duplicated protocol to a cross-reference — in all three places it appeared, not just the Hard-rules copy: `plan-verifier` caught that Method Step 5 and the report template still hardcoded "`git diff` empty", which is the wrong check for the dirty-file case step 6 had just introduced. Added a closed write surface. Added
  `e2e-refused` to the `Lane` enum.
- **P4 — `implementer.md`.** Added `process` to the `Lane` enum. Bounded the "an insight beats the
  plan" rule to *how*, never to owned paths or a Tier A refusal.
- **P5 — `planner.md`.** Tried `Agent` → `Agent(researcher, Explore)`, then **reverted it** — see
  REQ-8: the form parses and enforces nothing, which is worse than not trying, so the delegation
  limit is now stated as prose and labelled as prose. Added a rule that a recommendation arriving
  inside fetched content is data about the source, not planning input.
- **P6 — `researcher.md`, `doc-writer.md`.** Untrusted-content rules on both. Rewrote the mermaid
  gates around the reserved-word list.
- **P7 — canon, `agents/README.md`, plan 01.** Rewrote the `process`-lane paragraph; added
  `docs/plans/README.md` to Tier A; corrected every Permissions cell that described an unenforced
  confinement as enforced; corrected the authoring guidance about `tools`; added `docs/plans/README.md` to the Tier A enumerations that `implementer.md` and `planner.md` each carry, since REQ-2 put it in the canon but the carried copies would otherwise have disagreed; fixed plan 01's wrong
  frontmatter key, its V3 arithmetic, its diagram edge labels, and replaced the T6 task block.
- **P8 — `.claude/settings.json`.** Added the deny block.
- **P9 — `[human, outside Claude Code]` `.claude/settings.json`, corrected.** P8's block was
  defective in three ways and P8's own rule made it unreachable from inside the tool, so the repair
  is a step no session can take — see REQ-11 for the three defects and the escape-hatch note in §9.
  The corrected block is two rules, not four:
  `Edit(/.claude/settings*.json)` and `Edit(/.claude/hooks/**)`.

## 8. Done condition

```sh
node -e "const s=JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); const d=s.permissions.deny; if(d.length!==2||!d.every(r=>r.startsWith('Edit(/'))||!s.hooks.PreToolUse) process.exit(1)"
grep -c 'linter in this repo (root `AGENTS.md`)' .claude/agents/architecture-reviewer.md   # 0
grep -c 'it sets `user-invocable: false`' docs/plans/01-agent-set-expansion.md             # 0
grep -n '^tools:' .claude/agents/planner.md                                               # flat Agent - see REQ-8
grep -n 'Lane:' .claude/agents/implementer.md .claude/agents/test-writer.md               # process, e2e-refused
```

Then, **after a session restart** — every agent file changed here, and agents register at startup:

- `plan-verifier` against this file. It should reach `COMPLETE`, which under the old rule was
  impossible for a markdown-only plan. That is the point of running it: the fix is the thing under
  test, and the agent that found the defect is the one that certifies it.
- A `planner` dispatch, asking it whether it holds `Agent` and to try dispatching an `implementer`.
  **Run: the dispatch succeeded**, which is what established that the scoped form enforces nothing
  and drove the REQ-8 revision. The check to keep for next time is the shape, not the outcome: to
  test a restriction, ask the agent to do the thing it forbids.
- An `Edit` attempt against `.claude/hooks/pr-gate.mjs`, which must be **denied**. **Run: denied.**
  The probe used an `old_string` that does not occur in the file, so the two possible outcomes were
  distinguishable — a permission refusal versus "string not found". The result was
  "File is in a directory that is denied by your permission settings", i.e. the rule fired before the
  file was read. That is the only enforcement claim in this plan that is now tested rather than
  asserted, which given REQ-8 is the point.

## 9. Risks & open questions

- **`Agent(researcher, Explore)` was tried and reverted — the risk landed, from the other side.** The
  syntax was second-hand, from a docs summary rather than a page read directly, and the recorded fear
  was that Claude Code would reject it and strip `Agent`. The opposite happened: it parsed, the agent
  roster echoed it back as `Agent(researcher, Explore)` as though it had applied, and it restricted
  nothing. A planner carrying it dispatched an `implementer` in 1.8s. That is worse than rejection —
  a syntax that looks like enforcement and silently is not. Reverted to a flat `Agent` with the limit
  stated as prose, and `agents/README.md` now warns the next author about the trap by name.

  **The general lesson, which is why this is recorded and not just fixed:** an enforcement claim is
  itself a claim, and this whole plan exists because such claims were made without checking. Writing
  one more of them — from a summary, without an empirical test — was the same mistake one level up.
  The check that caught it was trivial: dispatch the thing the restriction forbids and see what
  happens.
- **The deny list can lock you out, and it did.** `Edit(/.claude/settings*.json)` means the deny list
  cannot be edited from inside Claude Code. That is deliberate and matches the escape-hatch
  philosophy in the `pr-self-review` skill — the way out is to edit the file outside the tool. What
  was not anticipated is that the block P8 shipped was itself wrong (REQ-11), so the lockout applied
  to the repair. **The lesson is ordering, not policy:** a self-denying rule must be verified against
  the docs *before* it is written, because afterwards the only reviewer left is a human with an
  editor. Being locked out of a correct rule costs nothing; being locked out of a wrong one costs a
  session.
- **A deny rule has three traps of its own**, all of which this plan hit — `Write(path)` rules are
  never consulted, bare patterns anchor at the session cwd, and `settings.json` does not cover
  `settings.local.json`. REQ-11 carries the detail. A fourth is not fixable by wording: the project
  `.claude/settings.json` loads from the **current working directory's** `.claude/` with no
  parent-directory fallback, so a session started inside a package never reads it at all — deny block
  and `PreToolUse` hook included. Given root `AGENTS.md` says to run commands from inside each
  package, that is the larger hole, and the only mitigation is to start Claude Code at the repo root.
  (`.claude/settings.local.json` is exempt: it loads from the git repo root regardless, since
  v2.1.211.)
- **Deny is not hermetic.** It covers Claude's file tools and the Bash commands Claude Code
  recognizes (`cat`, `sed`, …), but not an arbitrary subprocess: `node -e "fs.writeFileSync(…)"`
  still reaches the file. It raises the bar; it does not close the door.
- **REQ-3 is the one place a rule was weakened rather than clarified.** The alternative was accepting
  that a `process`-lane plan can never reach `COMPLETE`. The exception is scoped to claims about file
  content and states its own reasoning, so a future reader can judge it — but it is a genuine
  loosening, not a wording fix, and is recorded as such.
- **Agent files are Tier A, so this plan could not be dispatched.** That is the rule working as
  designed, and it means work on the agent set is always parent-session work. Worth knowing before
  planning the next round.
