---
name: pr-self-review
description: "Reviews the local working changes before a PR is opened, routing this project's own skills to the files each one governs, and refusing to proceed when a blocking finding exists. Deterministic checks (typecheck, tests, dependency-cruiser, migrations, contract drift, secrets) carry the verdict; skill-derived findings are reported alongside as advisory."
when_to_use: "Before opening a pull request; before pushing a feature branch; when the user says 'review my changes', 'self review', 'can I open the PR', 'check before I push', or runs /pr-self-review. NOT for reviewing a PR that already exists on GitHub — that is /review. NOT for a deep multi-agent audit of a whole branch — that is /code-review. NOT for a security-only pass — that is /security-review."
version: 1.0.2
user-invocable: true
---

# PR Self Review

Review the local diff before it becomes a pull request.

**The verdict comes from deterministic checks. Skill findings are advisory.**
That asymmetry is the whole design — see [README.md](README.md) for why. A gate
whose answer changes between runs on the same diff gets bypassed within weeks.

Worked runs: [examples.md](examples.md).

---

## Procedure

Run the phases in order. Stop early where told — sending a diff that does not
compile to a review pass wastes the run.

### Phase 0 — Resolve the diff

```bash
git branch --show-current                  # refuse on main/master
git diff --name-status main...HEAD         # committed on this branch
git status --porcelain                     # uncommitted
```

Default scope is **both**: everything on this branch plus uncommitted work.
`--staged` narrows to `git diff --cached`; `--since <ref>` to `<ref>...HEAD`.

**Exclude from review entirely:**

`pnpm-lock.yaml`, `package-lock.json`, `**/migrations/meta/**`,
`client/src/vendor/**`, `server/src/vendor/**` (vendored, explicitly out of
scope for both architecture skills), `docs/**`, `.claude/skills/**`,
`server/clones/**`, anything binary or generated.

If nothing survives the filter, report `PASS — no reviewable changes` and stop.

### Phase 1 — Deterministic checks (these decide the verdict)

Run what the diff touches. Do not run what it does not.

| Touched | Command | Failure |
|---|---|---|
| `server/**` | `pnpm typecheck` | CRITICAL |
| `server/**` | `pnpm arch` | CRITICAL |
| `server/**` | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | CRITICAL |
| `client/**` | `pnpm typecheck` | CRITICAL |
| `client/**` | `pnpm test` | CRITICAL |
| `reviewer-core/**` | `npm run typecheck && npm test` | CRITICAL |

#### Running a check without fooling yourself

A check that silently runs against the wrong package produces a **false green**,
which is worse than no check. This has already happened once while developing
this skill: a `cd client` failed, the shell stayed in `server/`, and the server
suite ran twice — reported as a passing client.

**Use exactly this shape. Do not improvise it** — three separate bugs of this
class showed up while writing this skill, including one in the first draft of
this very section.

```bash
cd /absolute/path/to/client || exit 1         # || exit 1 is not optional
pnpm typecheck > /tmp/check.log 2>&1; rc=$?   # capture rc on the SAME line
grep -m1 '^> @devdigest' /tmp/check.log       # which package really ran
echo "exit=$rc"
tail -5 /tmp/check.log
```

Why each part:

1. **Absolute path with `|| exit 1`.** A relative `cd` inherits whatever
   directory the previous command left behind. A failed `cd` without `|| exit 1`
   silently runs everything that follows in the wrong package.
2. **`rc=$?` on the same line as the command.** `$?` reflects the *last* command
   executed — an intervening `echo` resets it to 0. **Do not use a pipe** when
   you need the status: `cmd | grep` gives you grep's status, and the array that
   holds the real one is `$PIPESTATUS` in bash but `$pipestatus` in zsh. Redirect
   to a file and read it afterwards.
3. **Check the banner.** pnpm prints `> @devdigest/web@0.0.0 typecheck`. If it
   names `@devdigest/api` when you asked for the client, the check did not run —
   treat that as a failed check, never as a pass.

Sanity floor, as a second signal: the client suite is ~13 files / ~50 tests, the
server unit suite ~16 / ~101, the server *full* suite 22 / 129. A "client" run
reporting 22 files is the server suite. Stop and re-run.

**Not here:** `server`'s `*.it.test.ts` (testcontainers, ~36 s) and `e2e/**`.
They belong to CI, which is the layer that actually gates the merge. This phase
has a ~60 s budget; blow it and nobody runs the skill.

`pnpm arch` already ignores the baselined violations — a failure means a **new**
one. Report the rule name and the exact edge it printed.

**If any check fails: report, mark BLOCKED, stop.** Do not continue to Phase 3.

### Phase 2 — Load the baseline of known debt

Before judging anything, learn what has already been decided:

- `server/.dependency-cruiser-known-violations.json` — grandfathered architecture violations
- [docs/improvement-plan.md](../../../docs/improvement-plan.md) — open items with measured counts
- `*/LEARNINGS.md` for each touched module — decisions and their rationale
- the "Known deviations" section in each applied skill's README

A finding that matches known debt is **dropped**, or reported as MEDIUM tagged
`pre-existing` — never as a blocker.

**The exception is regression:** the diff making a known violation worse, or
adding a new instance of a class already at zero, is a fresh finding at full
severity.

`LEARNINGS.md` is also review *input*. It encodes traps no generic skill knows —
e.g. "PR-list columns live in three places that must stay in sync".

### Phase 3 — Route skills to files

Load only the skills the diff actually needs. **Cap at 4**; rank by how many
changed files each matches, and say which ones you skipped.

| Changed path | Skills |
|---|---|
| `client/src/app/**` | frontend-ui-architecture, next-best-practices, react-best-practices |
| `client/src/components/**`, `client/src/lib/**` | frontend-ui-architecture, react-best-practices |
| `client/**/*.test.tsx` | react-testing-library |
| `server/src/modules/**`, `platform/**`, `adapters/**` | onion-architecture, fastify-best-practices |
| `server/src/db/**` | drizzle-orm-patterns, postgresql-table-design |
| `**/contracts/**`, zod schemas | zod |
| `reviewer-core/**` | typescript-expert only — onion-architecture excludes it |
| any `.ts`/`.tsx` | security |

Respect each skill's own declared scope: `onion-architecture` covers
`server/src` only; `frontend-ui-architecture` covers the client only.

### Phase 4 — Repo-specific checks

Cheap, deterministic, and not covered by any general skill.

| Check | Severity |
|---|---|
| Secret shape in added lines — `sk-`, `ghp_`, `AKIA`, PEM header, long base64 assigned to `key`/`token`/`secret` | CRITICAL |
| `.only(` in a test file — silently disables the rest of the suite while CI stays green | CRITICAL |
| An already-applied migration edited (not a new file) | CRITICAL |
| `server/src/db/schema/**` changed with no new migration | HIGH |
| One `vendor/shared` copy changed without the other | HIGH |
| New user-facing string in `client/src` with no `messages/en/*.json` entry | HIGH |
| New exported function/component with no `*.test.ts(x)` in the same diff | HIGH |
| `console.log`, `debugger`, `.skip(` left in added lines | MEDIUM |
| Substantive module change with no `LEARNINGS.md` entry | MEDIUM |

### Phase 5 — Draft findings from the routed skills

Read the diff hunks and apply the loaded skills.

**Findings land on lines present in the diff.** A finding about surrounding
context is allowed only when the change made it wrong — e.g. a new prop makes an
existing `key={i}` reorderable. Deleted lines are not reviewed.

#### Relocated code is not new code

A refactor that extracts a component or moves a function produces a **new file
whose every line reads as added**. Reporting those lines makes the author
responsible for code they only carried across — the same noise problem §12
exists to prevent, arriving through a different door. Git's rename detection
does not help: an extraction is a partial move, not a rename.

**Before reporting any finding on a file added in this diff**, check whether that
logic already existed at the merge base:

```bash
# does this exact line exist anywhere on main?
git grep -F "const allFindings: FindingRecord\[\] = React.useMemo(" main -- '*.ts*'

# or, for a whole extracted block, compare against the file it came from
git show main:client/src/app/.../page.tsx | grep -A3 'useMemo'
```

Then:

| Case | Action |
|---|---|
| Line exists on `main`, unchanged | **Drop it.** Pre-existing; not this PR's business. |
| Exists on `main`, but the move changed it | Report normally — the edit is this diff's. |
| Exists on `main`, and the move made it *wrong* in the new context | Report at full severity, and say what the move changed. |
| Genuinely new | Report normally. |

Worth flagging in the PR description rather than as a finding: "N lines moved
verbatim from X to Y" tells a reviewer where not to spend attention.

### Phase 6 — Verify before reporting

For every candidate:

1. Does that file and line exist in the diff?
2. Is the claim still true after reading the surrounding code, not just the hunk?
3. Is it already handled — a guard higher up, a type that makes it impossible?
4. Can you state a concrete failure: inputs and state in, wrong output or crash out?

Survivors are `CONFIRMED`. Ones you believe but cannot fully verify are
`PLAUSIBLE`. Anything failing 1–3 is **dropped**, not downgraded.

**No failure scenario means it is not a finding.** "Consider extracting this" is
a suggestion — MEDIUM at most, never blocking.

## Severity rubric

This skill owns severity, because 8 of the 13 skills it routes to have no
severity vocabulary at all — a gate keyed on their wording would never fire for
Fastify, Next.js or DB work.
Classify every finding here, regardless of which skill produced the rule.

- **CRITICAL** — ships a bug, a security hole, or data loss; breaks the
  dependency rule or the RSC boundary in a way that changes runtime behaviour;
  silently disables tests.
- **HIGH** — will not scale, or breaks on the next change. No user-visible defect
  today.
- **MEDIUM** — consistency, naming, readability.

## The verdict

**BLOCKED** when either:

1. any Phase 1 or Phase 4 deterministic check failed, **or**
2. a `CONFIRMED` model finding falls in this closed list:
   - a hardcoded secret or credential
   - a mutating route or Server Action with no authorization check
   - `dangerouslySetInnerHTML` / raw SQL built from non-constant input
   - an already-applied migration edited

Everything else — including every HIGH — is **reported, not blocking**. Widening
that list trades trust for coverage, and trust is what keeps the gate alive.

## Output

Use `ReportFindings` for the list, then one verdict block:

```
BLOCKED — 2 blocking findings.

  gate  server/src/modules/settings/routes.ts:29   route queries the DB directly (pnpm arch)
  gate  client/src/lib/api.ts:14                   hardcoded token in an added line

  advisory: 4 high, 7 medium
  skills applied: frontend-ui-architecture, react-best-practices, onion-architecture
  skipped (budget): zod, typescript-expert
  suppressed: 1 (see footer)
```

A clean pass is **one line**: `PASS — 0 blocking, 2 medium.` Do not narrate
everything that was checked and found fine.

Cap the list at ~10 findings, most severe first, with a count of what was
omitted. Never repeat one rule more than 3 times — collapse it: "index-as-key in
6 places", with the file list.

Always state which findings gated and which were advisory. A user who cannot
tell them apart treats all of them as noise.

## Suppression

A line-level `// pr-self-review-ignore: <reason>` suppresses a finding on the
next line. The reason is required. List every suppression in a footer so it stays
visible instead of becoming invisible debt.

The whole run is skipped when `PR_SELF_REVIEW=0`. When skipped, say so loudly —
a silent bypass is worse than no gate.

## By-products

Do these on every run, blocking or not. A tool that only ever says "no" gets
resented.

- **Draft the PR description** — what changed, why, how it was verified, what was
  deliberately left out. There is no PR template in this repo; this is the
  de-facto one.
- **Suggest a reading order** for the reviewer — "start with `run-executor.ts`;
  the other 12 files are mechanical".

Neither ever affects the verdict.

## What this skill does not do

- **It does not block a merge.** It is instructions; it reports. Only GitHub
  branch protection stops the merge button. See [README.md](README.md) for the
  four enforcement layers and which of them exist today.
- It does not fix anything. Report; let the user decide.
- It does not review `reviewer-core/` architecture, vendored code, docs, or the
  skills themselves.
