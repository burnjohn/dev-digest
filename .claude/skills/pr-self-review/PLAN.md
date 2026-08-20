# PR Self Review — implementation plan

> **Superseded 2026-08-05.** `SKILL.md` is written; it is the source of truth.
> This file is kept as the design record — it holds the reasoning and the
> rejected alternatives that the skill itself does not carry. Where the two
> disagree, `SKILL.md` wins, and `references.md` records why.
>
> Decisions taken at authoring time, resolving §11:
> 1. **Subagent fan-out**, with a sequential fallback for when orchestration
>    opt-in is not granted (§7).
> 2. **Advisory only — layer A.** No `.claude/settings.json` hook was installed;
>    layers B and C are documented as follow-ups (§9).
> 3. **Docker unavailable → `WARN`** + a loud note; tests that ran and failed →
>    `critical` (§11.3, as recommended).
> 4. **CI parity out of scope**, so the taxonomy stays in `SKILL.md` and needs no
>    shared file yet (§11.4).
>
> Corrections the skill makes to this plan: §4's test command (`pnpm test` in
> `server/` runs both lanes and needs Docker — use the `pnpm exec vitest run`
> split), §4's lint caveat (all three eslint configs now exist), §5 gained a
> seventh invariant (`*.it.test.ts` naming), §3's self-check gained an explicit
> not-routed list, and §8's `treeHash` now hashes diff content rather than
> `git status --porcelain`.

## 1. Goal & scope

Gate the **local** diff before it becomes a pull request. Take every open change
(committed-but-unpushed + staged + unstaged + untracked), route it to the skills
in `.claude/skills/` that actually apply to those files, run the repo's
deterministic checks, and produce a single verdict: `PASS` / `WARN` / `BLOCKED`.
One critical finding ⇒ `BLOCKED`.

**In scope:** conformance to this repo's own skills and invariants.
**Out of scope:** general bug hunting — that is `/code-review`. The skill should
name that boundary and recommend `/code-review` rather than duplicate it.

Identity:

| | |
|---|---|
| Directory | `.claude/skills/pr-self-review/` |
| Frontmatter `name` | `pr-self-review` (kebab-case; `/pr-self-review` invokes it) |
| Files | `SKILL.md` (required), `references.md` (routing table rationale) |
| Catalog row | `.claude/skills/README.md`, scope **Workflow**, next to `engineering-insights` |

Triggers to put in the `description` frontmatter, so it fires without being asked:
before `gh pr create`, before `git push` of a feature branch, on "open a PR" /
"ready for review" / "self-review", and on explicit `/pr-self-review`.

## 2. Defining "all open changes"

```bash
BASE=$(git merge-base main HEAD)
git diff --name-status "$BASE"                 # committed + staged + unstaged vs base
git ls-files --others --exclude-standard       # untracked (62 files dirty right now — this matters)
```

Two-dot `git diff $BASE` (no `HEAD`) already folds the working tree in; untracked
files need the second command. Untracked source files are reviewed as
**whole-file additions**.

Excluded from content review (existence-checked only): `*-lock.yaml`,
`package-lock.json`, `dist/`, `.next/`, `INSIGHTS.md`, `_journal.json`.

Guard: if `BASE` resolves to `HEAD` (already on `main`), the skill stops and says
so instead of reviewing an empty diff.

## 3. Skill routing — file globs → skills

Source of truth is a **hardcoded table in `SKILL.md`**, not `skills-lock.json`
(root INSIGHTS 2026-07-29: the lock disagrees with disk in both directions).
The skill additionally runs `ls -d .claude/skills/*/` and flags any skill on disk
missing from the table as a maintenance warning — that is how the table stays
honest as skills are added.

| Glob in the diff | Skills to run |
|---|---|
| `client/src/**/*.{ts,tsx}` | `frontend-ui-architecture`, `react-best-practices` |
| `client/src/app/**` (page/layout/route/loading/error/not-found) | `+ next-best-practices` |
| `client/**/*.test.{ts,tsx}` | `react-testing-library` |
| `server/src/modules/**`, `server/src/platform/**`, `server/src/adapters/**`, `reviewer-core/src/**` | `onion-architecture` |
| `server/src/modules/**/routes.ts`, `server/src/app.ts` | `+ fastify-best-practices` |
| `server/src/db/schema/**` | `drizzle-orm-patterns`, `postgresql-table-design` |
| `server/src/db/migrations/**` | do-not-touch gate (§5) `+ postgresql-table-design` |
| any changed file containing `from 'zod'` | `zod` |
| any changed `*.ts`/`*.tsx` | `typescript-expert`, `security` |
| `e2e/**` | `e2e/CLAUDE.md` conventions (no skill exists) |
| `client/messages/**` | i18n key-parity checklist (no skill exists) |

Rules the table encodes, and that the SKILL.md must state:

- A skill runs **only** against the files its row matched — never the whole diff.
  A backend-only PR must not load the React skills, and vice versa. This is the
  cost control as much as the correctness one.
- `security` and `typescript-expert` are full-stack: they run on every changed
  source file regardless of side.
- If the diff matches no row (docs/config only) → verdict `PASS` with a note, and
  the mechanical gates in §4 still run.

## 4. Deterministic gates (run first, they are cheap and unarguable)

Order matters: fail fast on machine-checkable things before spending tokens on
skill conformance.

| Gate | Command | Runs when |
|---|---|---|
| Typecheck | `pnpm typecheck` (server, client) / `npm run typecheck` (reviewer-core, e2e) | that package appears in the diff |
| Lint | `pnpm lint` / `npm run lint` | package has both a `lint` script **and** an `eslint.config.*` |
| Layer rules | `pnpm arch` (dependency-cruiser) in `server/` | `server/**` or `reviewer-core/**` in the diff |
| Tests | `pnpm test` / `npm test` in touched packages | always; integration lane needs Docker — skip with a stated reason if unavailable |

Package-manager selection is per-directory, not global: `server/` and `client/`
are pnpm; `reviewer-core/` and `e2e/` are npm (root INSIGHTS 2026-07-29).
Running the wrong one creates a competing lockfile.

Lint caveat: as of this branch the eslint configs in `server/` and
`reviewer-core/` are untracked and `client/` has none. A missing config is a
**skipped gate with a note**, not a finding — otherwise every run reports a
critical that isn't about the diff.

## 5. Repo-invariant gates (this repo specifically)

These are the checks no generic reviewer would make. Each is **critical** when it
fires:

1. **Shared-contract desync** — diff touches `server/src/vendor/shared/**` but not
   the matching file under `client/src/vendor/shared/**` (or the reverse). There
   is no sync script and the mirror already lags in 5 files.
2. **Hand-edited migration** — diff modifies an *existing* file under
   `server/src/db/migrations/`. New generated files are fine; edits to old ones
   are not (`CLAUDE.md` do-not-touch).
3. **Schema without migration** — `server/src/db/schema/**` changed with no new
   `server/src/db/migrations/*.sql` in the same diff.
4. **Module not registered** — a new directory under `server/src/modules/` that
   `server/src/modules/index.ts` does not import (static registration, no autoload).
5. **ESM extension** — a relative import in `server/` or `reviewer-core/` missing
   the `.js` suffix. (`client/` must *not* have it.)
6. **Secret in the diff** — API key / token / `.env` value shape.

## 6. Severity taxonomy — the part that decides "blocked"

Without an explicit taxonomy every skill nit escalates to critical and the gate
becomes noise people bypass. So: **a skill-conformance violation is `major` by
default**; it is `critical` only if it matches this closed list.

| Severity | Definition | Examples |
|---|---|---|
| `critical` | Ships a defect, breaks a contract, or corrupts data | any §5 gate; failing typecheck/tests/`arch`; OWASP finding on a reachable path; unvalidated input reaching the DB or an LLM prompt; secret committed |
| `major` | Real architecture/correctness violation that doesn't ship a defect today | business logic in a route handler; persistence reaching past its port; client component that should be a server component; missing error boundary; new FK without an index; N+1 |
| `minor` | Style, naming, comment density, ordering | — |

Verdict mapping: any `critical` → **BLOCKED**. Zero critical + any `major` →
**WARN** (proceed allowed, findings must be shown). Otherwise **PASS**.

Each finding must carry `file:line`, the skill and rule it came from, the
severity, and a concrete fix. A finding without `file:line` is dropped — same bar
as `engineering-insights`.

## 7. Execution shape

Recommended: fan out one subagent per **package-slice × skill-cluster** (frontend,
backend-architecture, backend-data, full-stack/security) — 4–6 agents, each
receiving only its matched file list and its skills, returning a structured
findings array. Keeps each context small and lets a 60-file diff finish in one
pass. This is within the repo's medium workflow guideline (<15 agents).

Sequential fallback (no subagents): same phases, one at a time. Slower and
context-heavy on large diffs, but has no orchestration opt-in requirement.
**Decide this at authoring time** — it changes the SKILL.md's whole middle section.

Phases inside the skill:

1. Resolve diff + guard (§2)
2. Deterministic gates (§4) — abort early to `BLOCKED` on a hard failure
3. Repo-invariant gates (§5)
4. Route files → skills (§3), fan out, collect findings
5. Deduplicate (same `file:line` + same rule from two skills = one finding),
   assign severity (§6), compute verdict
6. Emit report + verdict artifact (§8)
7. Enforce (§9)

## 8. Output

**Human report** — markdown to the scratchpad, and printed inline:
verdict banner, one table of findings sorted critical→minor, gate results,
skipped-gate reasons, and the routing decision (which skills ran on which files)
so the user can see what was *not* checked.

**Machine verdict** — `.git/pr-self-review-verdict.json`. Inside `.git`, so it is
never committed and needs no `.gitignore` entry:

```json
{ "verdict": "BLOCKED", "critical": 2, "major": 5,
  "head": "<sha>", "treeHash": "<hash of git status --porcelain>",
  "generatedAt": "<iso>" }
```

`treeHash` is the anti-staleness field: a verdict whose `head`/`treeHash` no
longer match the working tree is **expired**, and enforcement must treat expired
the same as `BLOCKED`. Without it a stale `PASS` silently unblocks a changed diff.

## 9. Enforcement — what can and cannot actually block

Be honest about this in the SKILL.md; the three layers are not equivalent.

| Layer | Mechanism | Strength |
|---|---|---|
| A. In-skill | On `BLOCKED`, the agent refuses to run `gh pr create` / `git push`, states the criticals, offers to fix them | Soft — depends on the agent following its own instructions |
| B. Local hard gate | A `PreToolUse` hook in `.claude/settings.json` matching `Bash(gh pr create*)` and `Bash(git push*)`, reading the §8 verdict file and exiting non-zero when `BLOCKED` or expired. Or a `.git/hooks/pre-push` doing the same | Hard locally — the only layer the agent cannot talk its way past. Needs an explicit `--no-verify`-style escape hatch documented |
| C. Merge block | GitHub branch protection + a required CI check | **The only thing that can actually forbid a merge.** A local skill cannot — merge happens server-side |

The user's requirement "forbid merging" is genuinely layer C. Recommendation:
ship A + B now (they cover "before opening the PR", which is the stated intent),
and treat C as a follow-up that reuses the same taxonomy in a workflow under
`.github/workflows/`.

## 10. Build order

1. **Phase 1** — `SKILL.md` with §2 diff resolution, §3 routing table, §6
   taxonomy, §8 report. Manual `/pr-self-review` only, advisory verdict. Usable
   on its own.
2. **Phase 2** — wire the §4 deterministic gates and the §5 repo invariants.
3. **Phase 3** — layer B enforcement hook + `.claude/settings.json` entry.
4. **Phase 4** (optional) — layer C CI parity.

Validate Phase 1–2 against the current branch: 62 dirty files spanning client,
server, reviewer-core, migrations and skills is an unusually good test diff —
it should exercise nearly every routing row, and the `client/src/vendor/shared/`
lag should surface as a real critical.

## 11. Decisions needed before writing `SKILL.md`

1. **Subagent fan-out or sequential?** (§7) — changes the skill's structure.
2. **Hard local gate (layer B) now, or advisory only?** (§9) — a hook that blocks
   `git push` affects every session in this repo, not just self-review runs.
3. **Does a failing/absent test suite block?** Integration tests need Docker; if
   "unavailable" downgrades to a warning, the gate is bypassable by stopping
   Docker. Recommendation: absent Docker → `WARN` + loud note; failing tests when
   they *did* run → `critical`.
4. **CI parity (layer C) in scope?** If yes, the taxonomy in §6 must live in a
   shared file both the skill and the workflow read, not be duplicated.
