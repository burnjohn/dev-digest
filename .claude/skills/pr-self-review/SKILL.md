---
name: pr-self-review
description: Gates the local diff before it becomes a pull request. Collects every open change (committed-but-unpushed + staged + unstaged + untracked), runs the repo's deterministic gates and its own invariants, routes each changed file to the skills that actually apply to it, and emits a single PASS / WARN / BLOCKED verdict — one critical finding blocks. Use before `gh pr create`, before pushing a feature branch, and on "open a PR" / "ready for review" / "self-review" / "check my changes before the PR", or when /pr-self-review is invoked. Checks conformance to this repo's skills and invariants — for general bug hunting use /code-review instead.
---

# PR Self Review

Review **the changes that are about to become a PR**, against the skills and
invariants of this repo, and return one verdict.

**In scope:** conformance to `.claude/skills/` and to this repo's documented
invariants.
**Out of scope:** general bug hunting, logic review, "is this a good idea" —
that's `/code-review`. When the diff needs that, say so and recommend it; do not
duplicate it here.

Run the phases in order. Phases 1–3 are cheap and mechanical; they gate whether
the expensive phase 4 is worth running at all.

## Phase 1 — Resolve the diff

```bash
BASE=$(git merge-base main HEAD)
git rev-parse HEAD                              # record for the verdict file
git diff --name-status "$BASE"                  # committed + staged + unstaged vs base
git ls-files --others --exclude-standard        # untracked
```

Two-dot `git diff $BASE` (no `HEAD`) already folds the working tree in. Untracked
files need the second command and are reviewed as **whole-file additions**.

**Guard:** if `BASE` equals `HEAD`, you are on `main` with nothing ahead. Stop and
say so — do not review an empty diff.

Existence-checked only, never content-reviewed (they blow up context and say
nothing about conformance):

`*-lock.yaml` · `package-lock.json` · `dist/` · `.next/` · `INSIGHTS.md` ·
`_journal.json` · `server/clones/**`

`server/clones/` is checked-out third-party repositories, not this codebase —
never review it, never let it into a subagent's file list.

## Phase 2 — Deterministic gates

Machine-checkable and unarguable, so they run before any tokens go to skills.
Run each only for packages that appear in the diff.

| Gate | Command | Notes |
|---|---|---|
| Typecheck | `pnpm typecheck` (server, client) · `npm run typecheck` (reviewer-core, e2e) | |
| Lint | `pnpm lint` · `npm run lint` | needs both a `lint` script and an `eslint.config.*`; `e2e/` has neither |
| Layer rules | `cd server && pnpm arch` | when `server/**` or `reviewer-core/**` changed — depcruise covers both |
| Unit tests | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · `cd client && pnpm test` · `cd reviewer-core && npm test` | hermetic, no Docker |
| Integration | `cd server && pnpm exec vitest run .it.test` | needs Docker |

**Do not run `pnpm test` in `server/`** — it runs both lanes and fails without
Docker. `TESTING.md:83` explains why the split is invoked via `pnpm exec` rather
than committed `test:unit` scripts: `server/package.json` is `skip-worktree`.

**Package manager is per-directory, not global.** `server/` and `client/` are
pnpm; `reviewer-core/` and `e2e/` are npm. Running the wrong one creates a
competing lockfile.

Gate outcomes:

- **Failed** → `critical`. A failing typecheck, lint, `arch`, or test suite that
  actually ran is not negotiable.
- **Docker unavailable** → integration lane is `WARN` + a loud note naming what
  went unverified. Never silently pass.
- **Tool or config missing** → skipped gate with a stated reason, not a finding.
  A missing eslint config is not a defect in this diff.

On any hard failure, you may abort straight to `BLOCKED` and skip phase 4 —
report the failure and stop. Fixing a broken typecheck first is cheaper than
reviewing code that doesn't compile.

## Phase 3 — Repo invariants

The checks no generic reviewer makes. **Each is `critical` when it fires.**

1. **Shared-contract desync** — the diff touches `server/src/vendor/shared/**`
   without the matching file under `client/src/vendor/shared/**`, or the reverse.
   Two physical copies, no sync script, mirror already lags. Server is canonical.
2. **Hand-edited migration** — the diff modifies an *existing* file under
   `server/src/db/migrations/`. New generated files are fine; edits to old ones
   are not (`CLAUDE.md` do-not-touch).
3. **Schema without migration** — `server/src/db/schema/**` changed with no new
   `server/src/db/migrations/*.sql` in the same diff.
4. **Module not registered** — a new directory under `server/src/modules/` that
   `server/src/modules/index.ts` does not import. Registration is static; there
   is no filesystem autoload, so the module silently does not exist.
5. **ESM extension** — a relative import in `server/` or `reviewer-core/` missing
   the `.js` suffix. `client/` is a bundler target and must **not** have it.
6. **Secret in the diff** — API key, token, or `.env` value shape.
7. **Integration test misnamed** — a new test importing `test/helpers/pg.ts` (or
   otherwise DB-backed) not named `*.it.test.ts`. It lands in the unit lane and
   fails there without Docker.

## Phase 4 — Route files to skills

Source of truth is **this table**, not `skills-lock.json` — the lock disagrees
with disk in both directions (root `INSIGHTS.md`, 2026-07-29).

| Files in the diff | Skills |
|---|---|
| `client/src/**/*.{ts,tsx}` | `frontend-ui-architecture`, `react-best-practices` |
| `client/src/app/**` — page/layout/route/loading/error/not-found | + `next-best-practices` |
| `client/**/*.test.{ts,tsx}` | `react-testing-library` |
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**`, `reviewer-core/src/**` | `onion-architecture` |
| `server/src/modules/**/routes.ts`, `server/src/app.ts` | + `fastify-best-practices` |
| `server/src/db/schema/**` | `drizzle-orm-patterns`, `postgresql-table-design` |
| `server/src/db/migrations/**` | phase-3 gate #2 + `postgresql-table-design` |
| any changed file importing `zod` | `zod` |
| any changed `*.ts` / `*.tsx` | `typescript-expert`, `security` |
| `e2e/**` | `e2e/CLAUDE.md` conventions — no skill exists |
| `client/messages/**` | i18n key-parity check across locales — no skill exists |

**A skill sees only the files its row matched — never the whole diff.** A
backend-only PR must not load the React skills, and the reverse. This is the cost
control as much as the correctness one. `security` and `typescript-expert` are
the deliberate exception: full-stack, every changed source file.

If the diff matches no row (docs/config only) → `PASS` with a note. Phases 2 and
3 still run.

**Keeping the table honest.** Run `ls -d .claude/skills/*/` and compare. Any skill
on disk that is neither in the table nor in this list is a maintenance warning —
report it as `minor` so the table gets updated as skills are added:

> Deliberately not routed: `pr-self-review` (this skill), `engineering-insights`
> and `mermaid-diagram` (workflow/authoring skills — they describe how to write
> things, they review nothing).

## Phase 5 — Execution

**Preferred: fan out.** Four clusters, each a subagent receiving *only* its
matched file list and its skills, returning a structured findings array:

| Cluster | Files | Skills |
|---|---|---|
| frontend | `client/src/**` | `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library` |
| backend-architecture | `server/src/{modules,platform,adapters}/**`, `reviewer-core/src/**` | `onion-architecture`, `fastify-best-practices` |
| backend-data | `server/src/db/**` | `drizzle-orm-patterns`, `postgresql-table-design` |
| full-stack | every changed `*.ts`/`*.tsx` | `typescript-expert`, `security`, `zod` |

Skip any cluster with no matched files. Four agents keeps a 60-file diff to one
pass and stays inside the repo's medium workflow guideline.

**Subagent fan-out requires the user's opt-in in this repo.** If it has not been
granted, do not ask twice and do not stall:

**Sequential fallback.** Run the same four clusters yourself, one at a time,
discarding each cluster's file contents before loading the next. Identical
findings, identical taxonomy — just slower, and context-heavy on a large diff.
Say in the report which mode ran, because it affects how much of a big diff was
actually held in context at once.

Each finding must carry `file:line`, the skill and rule it came from, a severity,
and a concrete fix. **A finding without `file:line` is dropped** — same bar as
`engineering-insights`. Deduplicate before scoring: same `file:line` + same rule
surfaced by two skills is one finding.

## Phase 6 — Severity and verdict

Without an explicit taxonomy every nit escalates to critical and the gate becomes
noise people bypass. So: **a skill-conformance violation is `major` by default**,
and `critical` only if it matches the closed list below.

| Severity | Definition | Examples |
|---|---|---|
| `critical` | Ships a defect, breaks a contract, or corrupts data | any phase-3 invariant; a failed phase-2 gate; OWASP finding on a reachable path; unvalidated input reaching the DB or an LLM prompt; committed secret |
| `major` | Real violation that doesn't ship a defect today | business logic in a route handler; persistence reaching past its port; client component that should be server; missing error boundary; new FK without an index; N+1 |
| `minor` | Style, naming, ordering, comment density; routing-table drift | — |

| Verdict | When |
|---|---|
| **BLOCKED** | any `critical` |
| **WARN** | no `critical`, at least one `major` — proceeding is allowed, findings must be shown |
| **PASS** | otherwise |

## Phase 7 — Output

**Human report** — write to the scratchpad and print inline:

1. Verdict banner, and the count per severity.
2. Findings table sorted critical → minor: `file:line` · severity · skill/rule ·
   fix.
3. Gate results, including every skipped gate **with its reason**.
4. The routing decision — which skills ran on which files, and which clusters
   were empty. This is what lets the user see what was *not* checked.
5. Execution mode (fan-out or sequential).

**Machine verdict** — `.git/pr-self-review-verdict.json`. It lives inside `.git`,
so it is never committed and needs no `.gitignore` entry:

```json
{ "verdict": "BLOCKED", "critical": 2, "major": 5, "minor": 1,
  "head": "<sha>", "treeHash": "<see below>", "generatedAt": "<iso8601>" }
```

```bash
TREE_HASH=$( { git diff "$BASE"; \
               git ls-files --others --exclude-standard | sort | xargs -r git hash-object; \
             } | git hash-object --stdin )
```

`treeHash` is the anti-staleness field — it covers tracked-change *content* plus
the identity of every untracked file. A verdict whose `head` or `treeHash` no
longer matches the working tree is **expired**, and expired must be treated
exactly like `BLOCKED`. Without it, a stale `PASS` silently unblocks a diff that
has changed since.

## Phase 8 — Enforcement

Be honest about the strength of this gate; it is advisory by design.

**What this skill does (layer A).** On `BLOCKED` — or on an expired verdict —
refuse to run `gh pr create` or `git push` for the feature branch, state the
criticals, and offer to fix them. Re-run this skill after fixing; a fix
invalidates `treeHash`, so the old verdict cannot be reused.

This is **soft**: it depends on the agent honouring its own instructions, and it
does not survive a fresh session that never loaded this skill.

**What it deliberately does not do.**

- **Layer B — hard local gate.** A `PreToolUse` hook in `.claude/settings.json`
  matching `Bash(gh pr create*)` / `Bash(git push*)` that reads the verdict file
  and exits non-zero on `BLOCKED` or expired (equivalently, a `.git/hooks/pre-push`).
  This is the only layer an agent cannot talk its way past. **Not installed** —
  it would affect every session in this repo, not just self-review runs, and it
  needs a documented escape hatch before it goes in.
- **Layer C — merge block.** GitHub branch protection plus a required CI check.
  **This is the only thing that can actually forbid a merge**, because merging
  happens server-side; a local skill cannot. Not installed.

Say this plainly when reporting `BLOCKED`: the changes are blocked *by
convention*, and someone who ignores the report can still open and merge the PR.
If a real merge block is wanted, that is layer C — a workflow under
`.github/workflows/` reusing the phase-6 taxonomy, which must then move to a
shared file rather than being duplicated.
