# Plan — `pr-self-review` skill

> **Status — built and run once** (updated 2026-08-02; PreToolUse hook added 2026-09-07).
> The skill ships at [`.claude/skills/pr-self-review/`](../.claude/skills/pr-self-review/SKILL.md)
> v1.0.2. 18 of 20 sections are implemented. What remains is the tuning
> feedback loop and the client-side deterministic-check gap — deliberately,
> per §10.
>
> | § | Item | Status |
> |---|---|---|
> | 1 | Four enforcement layers | 🟡 3 of 4 — skill ✅, PreToolUse hook ✅ (personal/local, see §2), branch protection ✅ (no CI gate) |
> | 2 | Manual trigger `/pr-self-review` | ✅ `user-invocable: true` |
> | 2 | `PreToolUse` hook | ✅ `.claude/settings.json` — `scripts/pre-push-gate.sh` (2026-09-07). That settings file is gitignored in this repo, so the hook is per-machine, not team-shared |
> | 2 | Escape hatch `PR_SELF_REVIEW=0` | ✅ |
> | 3 | Routing table | ✅ Phase 3, cap 4 |
> | 4 | Severity model | ✅ **option A** — the skill owns the rubric |
> | 5 | Deterministic checks first | ✅ Phase 1 |
> | 6 | Repo-specific checks | ✅ Phase 4 |
> | 7 | Output + `ReportFindings` | ✅ |
> | 8 | Differentiation from `/code-review`, `/review` | ✅ in `when_to_use` |
> | 9 | File layout | ✅ SKILL + examples + README |
> | 10 | Build order steps 1–8 (`PreToolUse` hook) | ✅ |
> | 10 | Build order step 9 (branch protection) | 🟡 rule active, no CI gate |
> | 11 | Determinism — verdict split | ✅ the load-bearing decision |
> | 12 | Changed lines, not files | ✅ Phase 0 exclusions + Phase 5 |
> | 13 | Verify before reporting | ✅ Phase 6, CONFIRMED/PLAUSIBLE |
> | 14 | Do not re-report known debt | ✅ Phase 2 |
> | 15 | Noise budget + suppression | ✅ |
> | 16 | Extra deterministic checks | ✅ Phase 4 |
> | 17 | By-products (PR description) | ✅ |
> | 18 | Performance budget | ✅ ~60 s, excludes `*.it.test.ts` and e2e |
> | 19 | Tuning log / feedback loop | ⬜ not built |
> | 20 | Open questions | 🟡 1 of 7 resolved |

## What the first real run proved

Run against this plan's own branch (37 reviewable files, client + server):

```
PASS — 0 blocking, 1 high, 2 medium.
  server typecheck ✓  arch ✓ (0 new, 17 baselined)  unit 101 ✓
  client typecheck ✓  tests 50 ✓
```

**§14 earned its place immediately.** `arch:all` reports 17 violations in files
the diff touches; the baseline suppressed every one. Without Phase 2 the first
run would have emitted 20 findings instead of 3.

**The run also found three defects in the skill itself**, all fixed in v1.0.1:

1. A Phase 1 check ran against the wrong package and reported green — a failed
   `cd` left the shell in `server/`, and `exit=$?` after an intervening `echo`
   always reads 0.
2. Relocated code was treated as new: an extracted component is a new file whose
   every line reads as added, so `useMemo([reviews])` carried across verbatim
   looked like a fresh finding. §12 covered renames but not extractions.
3. While writing the fix for (1), two more bugs of the same family: `head -1`
   misses pnpm's banner (blank first line), and a pipe destroys the exit code —
   `$PIPESTATUS` in bash is `$pipestatus` in zsh.

Three instances of one class in a single session is why the skill now prescribes
an exact command shape rather than a principle.

---

Original plan follows. Sections marked ✅ above are implemented; the prose is
kept because it records *why*.

Goal: before a PR is opened, review the local working changes against **this
project's own skills**, routing each skill to the files it actually governs, and
refuse to proceed when a CRITICAL finding exists.

---

## 1. The uncomfortable part first: a skill cannot block a merge

You asked for "заборонити мержити". A skill is instructions loaded into a model
— it produces findings, it does not gate anything. Blocking is a property of the
mechanism that *invokes* it. Four layers, only some of which actually stop
anything:

| Layer | Blocks what | Bypassable by | Exists today |
|---|---|---|---|
| The skill itself | nothing — it reports | ignoring the output | ✅ built, v1.0.2 |
| Claude Code hook (`PreToolUse` on Bash) | the **agent** running `git push` | running push in a terminal, `PR_SELF_REVIEW=0` | ✅ built (2026-09-07), `.claude/settings.json` → `scripts/pre-push-gate.sh` — personal/local, that file is gitignored in this repo |
| `.git/hooks/pre-push` | any push **from this machine** | `--no-verify`, another clone | ⬜ no git hooks installed |
| GitHub branch protection + required check | the **actual merge button** | admin override | 🟡 rule active on `main` and sane, but **zero required status checks** — see §20 q5 |

**Recommendation: build all four, and be explicit that only the fourth is a real
gate.** The first three are fast local feedback that stops you *wasting a PR*;
the fourth is what stops a merge. A plan that promises blocking from the skill
alone would be selling you something that does not exist.

Practical consequence for the skill's own copy: it must say "this run found N
criticals — do not open the PR" and *not* claim to have prevented anything.

## 2. Trigger design

### Manual
`/pr-self-review` — the primary path. Also `/pr-self-review --staged`,
`--since <ref>`, `--all`.

### Automatic "before opening a PR"
The obvious hook is `PreToolUse` on Bash matching `gh pr create`. `gh` 2.97.0
was installed on 2026-08-02 but is **not authenticated**, so a matcher on it
still would not fire in practice. The real signal remains `git push` of a
non-default branch.

Proposed matcher, in `.claude/settings.json`:

- `PreToolUse` on `Bash`, command matches `git push` or `gh pr create`
- Skip when the branch is `main`
- Skip when the push is a no-op (`git diff --quiet @{u}` where upstream exists)

Add `gh` to the matcher anyway — it costs nothing and covers the machine where
it *is* installed.

### The escape hatch is mandatory
A gate with no bypass gets disabled entirely. Provide `--no-verify`-equivalent
(`PR_SELF_REVIEW=0`) and make the skill state loudly when it was skipped.

## 3. Routing: diff → skills

No skill declares a file scope in its frontmatter (verified — zero use `globs`
or `paths`). So the routing table lives in this skill. It must respect what each
skill says about its own scope in prose, which two of them are explicit about:
`onion-architecture` excludes `client/` and `reviewer-core/`;
`frontend-ui-architecture` excludes the server.

| Changed path | Skills to apply |
|---|---|
| `client/src/app/**` | frontend-ui-architecture, next-best-practices, react-best-practices |
| `client/src/components/**`, `client/src/lib/**` | frontend-ui-architecture, react-best-practices |
| `client/**/*.test.tsx` | react-testing-library |
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**` | onion-architecture, fastify-best-practices |
| `server/src/db/**` | drizzle-orm-patterns, postgresql-table-design |
| `**/vendor/shared/**` | zod + the contract-drift check (§6) |
| `reviewer-core/**` | typescript-expert only — onion-architecture explicitly excludes it |
| `e2e/**` | none today (no e2e skill exists) |
| `.claude/skills/**` | none — reviewing the reviewer is out of scope |
| any TS/TSX | security, typescript-expert |

**Budget rule.** A 3-file diff must not load 8 skills. Cap at ~4 skills per run,
ranked by how many changed files each matches; say in the output which ones were
skipped and why.

## 4. The severity problem — this needs a decision

"Block on one CRITICAL" assumes every skill emits comparable severities. It does
not. Measured across all 13 skills:

| Has CRITICAL/HIGH/MEDIUM | Has no severity vocabulary at all |
|---|---|
| frontend-ui-architecture, onion-architecture, react-best-practices, security, zod | drizzle-orm-patterns, fastify-best-practices, next-best-practices, postgresql-table-design, react-testing-library, typescript-expert, mermaid-diagram, engineering-insights |

**8 of 13 skills cannot produce a CRITICAL.** A gate keyed on the word would
silently never fire for backend Fastify work, Next.js work, or DB design.

Three options:

- **A — the review skill owns severity.** It defines the rubric once and
  classifies every finding itself, using the source skills only as the rule
  source. Consistent immediately; the tradeoff is the classification is the
  reviewer's judgement, not the skill author's. **Recommended.**
- **B — add severity to the other 8 skills.** Most correct, most work, and three
  of those skills are vendored from GitHub (`skills-lock.json`) so edits get
  overwritten on update.
- **C — gate only on the 5 that have severity.** Cheapest, but leaves whole
  areas ungated, which is worse than no gate because it looks like coverage.

Under option A the rubric must be written down in the skill, not left implicit.
Draft:

> **CRITICAL** — ships a bug, a security hole, data loss, or breaks the
> dependency rule / RSC boundary in a way that changes runtime behaviour.
> **HIGH** — will not scale or will break on the next change; no user-visible
> defect today. **MEDIUM** — consistency and readability.

Only CRITICAL blocks. HIGH is reported and counted, never blocking — otherwise
the gate fires on every PR and gets bypassed by habit.

## 5. Run deterministic checks before the model looks at anything

The repo already knows a lot mechanically. Re-deriving it by reading the diff is
slower and less reliable:

| Check | Command | Fails on |
|---|---|---|
| Backend architecture | `cd server && pnpm arch` | any violation not in the baseline |
| Types | `pnpm typecheck` (both packages) | any error |
| Tests | `pnpm test` (both) | any failure |
| Client boundaries | *does not exist yet* — item 6 of [improvement-plan.md](improvement-plan.md) | — |

**These are automatic CRITICALs and need no model judgement.** A failing
typecheck or a new `pnpm arch` violation is not an opinion.

Order matters: run these first, and if they fail, report and stop. Sending a
diff that does not compile to a model-driven review wastes the run.

This also means the skill's value is concentrated where tooling *cannot* reach —
naming, placement, composition, missing tests, unclear boundaries.

## 6. Repo-specific checks worth building in

Things that have bitten this project and that no generic skill covers:

- **`vendor/shared` drift.** If the diff touches either copy and not the other,
  flag it. Currently drifted on `CommitFile`, `CommitFilesPayload`, `sessionId`.
- **Migrations.** A changed `db/schema/**` without a new migration file, or an
  edit to an already-applied migration — the latter is a CRITICAL.
- **i18n.** New user-facing string literals in `client/src` with no
  `messages/en/*.json` entry.
- **`LEARNINGS.md`.** Substantive change to a module with no learnings entry —
  MEDIUM, a nudge, never blocking.

## 7. Output

Use the `ReportFindings` tool so the host renders findings as a list, ranked
most-severe first, each with file, line, and a concrete failure scenario. Then a
short verdict line:

```
BLOCKED — 2 critical findings. Do not open this PR.
   1. client/src/app/repos/[repoId]/pulls/page.tsx:41  index-as-key on a reorderable list
   2. server/src/modules/settings/routes.ts:29         route queries the DB directly

Also: 4 high, 7 medium. Skills applied: frontend-ui-architecture, react-best-practices,
onion-architecture. Skipped (budget): zod, typescript-expert.
```

Non-negotiable: **no finding without a file and line**. A review that says
"consider improving error handling" is noise, and noise is what makes people
turn gates off.

## 8. Relationship to the review commands that already exist

Three overlapping things already exist; the skill must not duplicate them and
should say so in its own description:

| Existing | Scope | Differs how |
|---|---|---|
| `/code-review` (ultrareview) | multi-agent cloud review of branch or PR; user-triggered, billed | heavier, remote, generic — not driven by *our* skills |
| `/review` | reviews a GitHub PR that already exists | after the fact; this skill runs before |
| `/security-review` | security of pending changes | one dimension; this one routes many skills |

Positioning line for the description: *local, pre-PR, project-skill-driven,
gating*. Nothing else in the toolbox is all four.

## 9. Proposed file layout

Matching the two architecture skills — no `PLAN.md` inside the skill folder.

```
.claude/skills/pr-self-review/
├── SKILL.md      the procedure, routing table, severity rubric, verdict format
├── examples.md   one worked run on a real diff, plus a clean-pass example
└── README.md     rationale, the four enforcement layers, sources, changelog
```

Frontmatter: `name`, `description`, `when_to_use` (including negative triggers
pointing at `/code-review` and `/review`), `version`.

Plus, outside the skill:

- `.claude/settings.json` — the `PreToolUse` hook
- `.git/hooks/pre-push` — optional, machine-local, committed as
  `scripts/hooks/pre-push` with an installer since git hooks are not versioned
- GitHub branch protection — the only real merge gate, configured in repo settings

## 10. Build order

1. ~~`SKILL.md` with manual invocation only~~ ✅
2. ~~Deterministic checks (§5) + diff scoping (§12)~~ ✅
3. ~~Baseline awareness (§14)~~ ✅ — and it paid off on run one: suppressed all
   17 baselined violations
4. ~~Routing table + severity rubric (§3, §4)~~ ✅ option A
5. ~~Verification pass + noise budget (§13, §15)~~ ✅
6. ~~Repo-specific and cheap deterministic checks (§6, §16)~~ ✅
7. ~~By-products: PR description draft (§17)~~ ✅
8. ~~`PreToolUse` hook (§2)~~ ✅ (2026-09-07) — `scripts/pre-push-gate.sh`,
   verified with a deliberate `server/` typecheck break (blocked) and a clean
   run (allowed). Personal/local only — `.claude/settings.json` is gitignored
   in this repo
9. Branch protection — ⬜ the actual gate. Blocked on two repo problems found
   while looking: three workflow jobs share the name `tests`, and all five
   workflows filter `pull_request` by path. `scripts/setup-branch-protection.sh`
   refuses to apply until both are fixed

Steps 1–3 are worth doing even if nothing else follows. Note the ordering
change: baseline awareness moved ahead of the routing/severity work, because
without it the very first run looks broken.

## 11. Determinism — the thing that decides whether the gate survives

**A blocking gate must give the same verdict twice on the same diff.** Model
output does not. If the same unchanged branch blocks on Monday and passes on
Tuesday, nobody trusts it, and within two weeks it is bypassed by habit or
deleted.

This is not a tuning detail — it constrains the architecture:

- **The gate is carried by deterministic checks only.** Typecheck, tests,
  `pnpm arch`, migration/i18n/drift rules (§5, §6) decide BLOCKED. They are
  reproducible by construction.
- **Model-derived findings are advisory by default.** They are reported,
  ranked, and counted — they do not flip the verdict.
- **One exception, narrowly drawn:** a model finding may block when it is
  `CONFIRMED` (§13) *and* falls in a closed list of categories where a false
  positive is cheap to dismiss and a miss is expensive — hardcoded secret,
  missing authorization check on a mutating route, `dangerouslySetInnerHTML`
  with non-constant input, an already-applied migration edited.

Say this in the skill's output, every run: which findings gated and which were
advisory. A user who cannot tell the difference will treat all of them as noise.

## 12. Scope the review to changed lines, not changed files

The most common way review tooling becomes unusable: it reports pre-existing
problems in a file because someone touched one line of it. The author did not
cause them, cannot fix them in this PR, and learns to skim past the output.

Rules:

- Findings must land on a line **present in the diff** (added or modified).
- A finding about surrounding context is allowed **only** when the change made it
  wrong — e.g. a new prop makes an existing `key={i}` reorderable.
- Deleted lines are not reviewed. Renames are followed, not re-reviewed.
- Skip by default: lockfiles, `**/migrations/**` snapshots, `client/src/vendor/**`
  and `server/src/vendor/**` (vendored, out of scope for both architecture
  skills), generated files, `docs/**`, `.claude/skills/**`.

Define the diff explicitly, because "open changes" is ambiguous:

| Mode | Range | When |
|---|---|---|
| default | `git diff main...HEAD` + uncommitted | pre-PR — the whole branch |
| `--staged` | `git diff --cached` | pre-commit |
| `--since <ref>` | `git diff <ref>...HEAD` | re-review after feedback |

## 13. Verify every finding before reporting it

Two-pass, and the `ReportFindings` tool already models it with a `verdict` field:

1. **Draft** — apply the routed skills, collect candidates.
2. **Verify** — for each candidate: does the file and line exist in the diff? Is
   the claim true after reading the surrounding code rather than the hunk alone?
   Is it already handled elsewhere (a guard higher up, a type that makes it
   impossible)?

Mark survivors `CONFIRMED`, the rest `PLAUSIBLE`, and drop anything that fails
verification entirely. **A finding with no concrete failure scenario — inputs and
state in, wrong output or crash out — is not a finding.** "Consider extracting
this" is a suggestion; suggestions belong under MEDIUM and never gate.

## 14. Do not re-report known debt

This repo already carries catalogued, accepted debt. Without this rule the
reviewer would emit ~17 findings on a PR that touches nothing relevant:

| Source | What it records |
|---|---|
| `server/.dependency-cruiser-known-violations.json` | 17 baselined architecture violations |
| [improvement-plan.md](improvement-plan.md) | 8 open items with measured counts |
| skill READMEs | "Known deviations" sections |
| `LEARNINGS.md` per module | decisions already made and their rationale |

Behaviour: read the baseline, and if a finding matches a known entry, either drop
it or report it as MEDIUM tagged *pre-existing* — never as a blocker. **The one
exception is a regression**: if the diff makes a known violation worse, or adds a
new instance of a class already at zero, that is a fresh finding.

`LEARNINGS.md` is also a review *input*, not just a suppression list — it encodes
project-specific traps a generic skill cannot know, like "columns live in three
places that must stay in sync".

## 15. Noise budget and suppression

- **Cap the output.** Max ~10 findings per run, ranked most severe first, with a
  count of what was omitted. A 40-item list is read by nobody.
- **Never repeat the same rule more than 3 times.** Collapse into one finding
  with a file list — "index-as-key in 6 places".
- **Suppression exists and is cheap:** a `// pr-self-review-ignore: <reason>`
  comment on the line, requiring a reason. Report suppressions in a footer so
  they stay visible rather than becoming invisible debt.
- **Silence on a clean pass.** One line: `PASS — 0 critical, 2 medium.` No
  summary of everything that was checked and found fine.

## 16. Checks worth adding that are not in any existing skill

- **New code with no test.** A new exported function or component in
  `client/src` / `server/src` with no matching `*.test.ts(x)` touched in the same
  diff → HIGH. This repo's convention is colocated tests, so the check is
  mechanical.
- **Secrets in the diff.** Added lines matching common key shapes
  (`sk-`, `ghp_`, `AKIA`, PEM headers, long base64 assigned to something named
  `key`/`token`/`secret`). Cheap, deterministic, and CRITICAL — this is exactly
  the category worth blocking on per §11.
- **`console.log` / `.only` / `.skip` / `debugger`** left in the diff. Trivial,
  and catches real embarrassment. `.only` in a test file is CRITICAL — it
  silently disables the rest of the suite while CI still reports green.
- **Cross-package contract change without both copies** — already in §6, but
  worth stating as CRITICAL rather than a warning, since the two `vendor/shared`
  copies have already drifted on four symbols.

## 17. Useful by-products of running before the PR

The skill has already read the whole diff. Two things fall out nearly free and
give it value even on a clean pass — which matters, because a tool that only ever
says "no" gets resented:

- **Draft the PR description** — what changed, why, how it was verified, what was
  deliberately left out. There is no PR template in the repo today; this could be
  the de-facto one.
- **Suggest the reviewer's attention order** — "start with `run-executor.ts`, the
  other 12 files are mechanical".

Both are output, never gating.

## 18. Performance budget

A pre-push gate competes with the user's patience, not with CI.

- **Target: under 60 seconds** for a typical diff, excluding tests.
- Deterministic checks run in parallel where they do not share a lock.
- **Full `pnpm test` does not belong in the pre-push gate** — server integration
  alone is ~36 s with testcontainers. Run unit tests locally; leave DB-backed and
  e2e to CI, which is the layer that actually gates the merge.
- Skip the model pass entirely when the diff is only lockfiles, docs, or
  generated output.

## 19. Tune it, or it will be turned off

No feedback loop means no way to tell a strict gate from a broken one.

- Append every run's outcome to a local, git-ignored log: diff size, findings by
  severity, verdict, whether the user pushed anyway.
- **Review it after ~20 runs.** If a rule has never once been agreed with, delete
  the rule. If the bypass is being used regularly, the gate is wrong, not the
  user.
- Treat this the way the architecture baseline is treated: rules earn their
  severity by proving themselves, and get promoted from advisory to blocking
  only after they do.

## 20. Open questions

1. ~~**Severity model — option A, B or C (§4)?**~~ ✅ **Resolved: option A** —
   the skill owns the rubric. Taken as an assumption when implementation started
   without an answer; recorded as such in the skill's changelog, so it can be
   revisited as a decision rather than discovered as a surprise.
2. **Should the gate block on `pnpm arch` regressions?** It already fails CI, so
   blocking locally is redundant but earlier. I would say yes, since earlier is
   the entire point.
3. **How hard is "blocked"?** Does the skill refuse to run `git push` (hook exit
   non-zero), or report and let you decide? Recommend: hook blocks, with
   `PR_SELF_REVIEW=0` as the documented bypass.
4. **Does `reviewer-core/` get reviewed at all?** `onion-architecture` explicitly
   excludes it and no other backend skill covers it.
5. **Is branch protection actually enabled?** 🟡 **Partly answered, 2026-08-02.**
   A rule exists on `main`. From the public API — no auth needed:

   ```
   GET /repos/viktormashyka/dev-digest/branches/main
   protected: true
   required_status_checks: { enforcement_level: "off", contexts: [], checks: [] }
   ```

   So the layer exists but **does not gate on CI**: a failing typecheck, test or
   `pnpm arch` does not block the merge button today. The rest of the rule —
   approval count, PR requirement, force-push block — needs admin access to read.

   Silver lining: because `contexts` is empty, the path-filter deadlock is
   **dormant**. It activates the moment any of the five workflows is made
   required, so the two blockers below must be fixed *before* that, not after:

   - three jobs share the name `tests` (client, reviewer-core, server-unit)
   - all five workflows filter `pull_request` by path

   Decision 2026-08-02: leave the workflows alone for now. Required checks stay
   off until someone chooses to fix the two blockers.

   **Rule contents, verified 2026-08-02** (screenshot of the edit page; the
   public API exposes neither `lock_branch` nor the approval count):

   | Setting | State | Note |
   |---|---|---|
   | Require a pull request | ✅ | direct pushes to `main` blocked |
   | Require approvals | ☐ | correct — GitHub never counts the author's own approval, so any value > 0 makes a solo repo unmergeable |
   | Require conversation resolution | ✅ | |
   | Require status checks | ☐ | **the CI gate is still absent** — deliberate |
   | Lock branch | ☐ | |
   | Allow force pushes / deletions | ☐ | history is protected |
   | Do not allow bypassing | ☐ | admin escape hatch retained |

   Two misconfigurations were caught and corrected on the way here, both of
   which would have made `main` permanently unmergeable:

   - **Lock branch was on.** GitHub's own description: "Branch is read-only.
     Users cannot push to the branch." It is meant for freezing or archiving a
     branch — with it set, even a fully approved PR with green checks cannot
     merge.
   - **Required approvals was 1** on a single-contributor repo.

   Net: layer 4 now protects the *history* and enforces the PR flow, but does
   not gate on *quality*. A failing typecheck, test or `pnpm arch` still does not
   block the merge button.
   Two prerequisites surfaced while looking: three jobs across different
   workflows are all named `tests` (ambiguous as a required context), and all
   five workflows filter `pull_request` by path — a required path-filtered check
   never runs on an unrelated PR and blocks the merge button permanently.

6. **Does a model finding ever block (§11)?** My proposal is the narrow closed
   list — secrets, missing authz on a mutating route, unsafe HTML injection,
   edited applied migration. Widening it trades trust for coverage, and trust is
   what makes the gate survive.

7. **Where does the tuning log live (§19)?** Git-ignored local file is simplest,
   but then it is per-machine and invisible to the team. A committed one turns
   review outcomes into repo history, which may be more than you want.
