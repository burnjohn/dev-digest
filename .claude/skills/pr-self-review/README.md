# pr-self-review

**Version 1.0.1** · Local, pre-PR, project-skill-driven review with a gate.

| File | Audience | Contents |
|---|---|---|
| [SKILL.md](SKILL.md) | agent | The procedure, routing table, rubric, verdict rules |
| [examples.md](examples.md) | agent | Worked runs; good vs bad findings |
| README.md | human | Design decisions, enforcement layers, what is not built yet |

Design rationale and the full analysis this was built from:
[docs/pr-self-review-plan.md](../../../docs/pr-self-review-plan.md).

## What it is

Runs against the local working diff before a PR exists. Routes this repo's own
skills to the files each one governs, runs the deterministic checks the repo
already has, and gives a verdict.

## What it is not

| Existing tool | Scope | Why this is different |
|---|---|---|
| `/code-review` | multi-agent cloud review of a branch or PR; billed | heavier, remote, generic — not driven by *our* skills |
| `/review` | reviews a GitHub PR that already exists | after the fact; this runs before |
| `/security-review` | security of pending changes | one dimension; this routes many skills |

Positioning: **local, pre-PR, project-skill-driven, gating.** Nothing else in
the toolbox is all four.

## The load-bearing decision: deterministic checks carry the verdict

A blocking gate must give the same answer twice on the same diff. Model output
does not. If an unchanged branch blocks on Monday and passes on Tuesday, the gate
is bypassed by habit within weeks and then deleted.

So the architecture splits:

- **Verdict** — typecheck, tests, `pnpm arch`, migration/i18n/drift/secret checks.
  Reproducible by construction.
- **Advisory** — everything derived from reading the diff against a skill.
  Reported, ranked, counted; does not flip the verdict.
- **One narrow exception** — a `CONFIRMED` finding in a closed list (secret,
  missing authz on a mutating route, unsafe HTML/SQL injection, edited applied
  migration) blocks. Widening that list trades trust for coverage, and trust is
  what keeps the gate alive.

Every run states which findings gated and which were advisory. A user who cannot
tell them apart treats all of them as noise.

## Other decisions

**1. This skill owns severity.**
Measured across the 13 skills this one can route to: only 5 have a
CRITICAL/HIGH/MEDIUM vocabulary. The other 8 — including `fastify-best-practices`,
`next-best-practices` and `drizzle-orm-patterns` — have none. A gate keyed on
their wording would never fire for backend Fastify work, Next.js work or DB
design. Rather than edit 8 skills (3 of which are vendored from GitHub via
`skills-lock.json` and would be overwritten on update), the rubric lives here and
is applied uniformly.

**2. Changed lines, not changed files.**
Findings must land on a line present in the diff. Reporting pre-existing problems
because someone touched one line of a file is the fastest way to make review
output unreadable — the author did not cause them and cannot fix them here.

**3. Known debt is not re-reported.**
The repo carries 17 baselined architecture violations and 8 open
[improvement-plan](../../../docs/improvement-plan.md) items. Without Phase 2 the
first run would emit roughly 17 findings about debt already decided on, and look
broken. Regressions against the baseline are still full findings.

**4. `LEARNINGS.md` is an input, not just a filter.**
It encodes traps no general skill knows — "PR-list columns live in three places
that must stay in sync" is not in any React guide.

**5. Advisory findings never block, including HIGH.**
A gate that fires on every PR gets bypassed on every PR.

**6. Escape hatches are mandatory.**
`PR_SELF_REVIEW=0` skips the run; `// pr-self-review-ignore: <reason>` suppresses
one line. Both are reported loudly. A gate with no bypass is not stricter — it is
just disabled sooner.

## Enforcement layers — only one of these blocks a merge

The skill reports. It cannot stop anything by itself.

| Layer | Blocks | Status |
|---|---|---|
| This skill | nothing — it reports | ✅ built |
| `PreToolUse` hook on `git push` / `gh pr create` | the agent's push | ✅ built (2026-09-07) — `.claude/settings.json`, personal/local (that file is gitignored in this repo, so this layer is per-machine, not team-wide) |
| `.git/hooks/pre-push` | any push from this machine | ⬜ none installed |
| GitHub branch protection + required checks | **the merge button** | ⬜ not verified |

Two prerequisites block the last layer, both found by inspection:

- **Three jobs are named `tests`** (client, reviewer-core, server-unit). Branch
  protection stores a plain context string, so the name is ambiguous.
- **All five workflows filter `pull_request` by path.** A required path-filtered
  check never runs on an unrelated PR, and a required check that never runs
  leaves the merge button disabled permanently.

`scripts/setup-branch-protection.sh` derives the check names from the workflows
and refuses to apply while either problem exists.

## Not built yet

Deliberately shipped as steps 1–6 of the plan's build order. Outstanding:

- The tuning log (plan §19) — no feedback loop yet, so there is currently no way
  to tell a strict gate from a broken one
- Client-side boundary enforcement — the server has `pnpm arch`; the client has
  no equivalent, so Phase 1 is thinner on the frontend
  ([improvement-plan](../../../docs/improvement-plan.md) item 6)
- A real caught case for the `PreToolUse` hook below — not yet observed
  organically; the hook has only been exercised with a deliberate break so far

## Changelog

### 1.0.2 — 2026-09-07

Added the `PreToolUse` hook (plan §2, build order step 8): `.claude/settings.json`
now runs `scripts/pre-push-gate.sh` before every `Bash` tool call; the script
itself narrows to `git push`/`gh pr create`, skips `main`/`master` and no-op
pushes, respects `PR_SELF_REVIEW=0`, and otherwise re-runs Phase 1's
deterministic checks (scoped to the branch's touched paths) — a guaranteed,
non-LLM version of Phase 1 only, not the skill's full advisory review.
Verified with a deliberate `server/` typecheck break (blocked, exit 2, error
surfaced) and a clean run (allowed, exit 0, ~91s for a large multi-package
diff). `.claude/settings.json` is gitignored in this repo, so this layer is
currently personal/local, not shared with other contributors.

### 1.0.1 — 2026-08-02

Two defects found by running the skill on its own branch:

- **A check ran against the wrong package and reported green.** A failed `cd`
  left the shell in `server/`, `exit=$?` was read after an intervening `echo`
  (always 0), and the server suite ran twice — presented as a passing client.
  Phase 1 now mandates absolute paths with `|| exit 1`, capturing the command's
  own exit code, and verifying the pnpm banner names the expected package.
  A false green is worse than no check.
- **Relocated code was treated as new code.** An extracted component is a new
  file whose every line reads as added, so pre-existing logic carried across
  verbatim looked like a fresh finding. Phase 5 now requires checking the merge
  base before reporting on any added file, with a four-case table for
  moved / moved-and-edited / moved-into-a-breaking-context / genuinely new.

Both are documented with the real transcripts in examples.md §6–7.

### 1.0.0 — 2026-08-02

Initial release. Seven-phase procedure; deterministic verdict with a four-entry
blocking exception list; routing table over 8 skills with a cap of 4; baseline
suppression; verification pass; noise budget; suppression comments; PR
description as a by-product.

Severity model: **option A** from the plan — this skill owns the rubric. Recorded
as an assumption, not an instruction received.

## Maintenance

Bump `version` in [SKILL.md](SKILL.md) and add a changelog entry when the
procedure or the blocking list changes. Revisit the routing table whenever a
skill is added to `.claude/skills/`, and the Phase 1 table whenever a package
gains or renames a script.
