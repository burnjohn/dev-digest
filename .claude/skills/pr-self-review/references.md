# PR Self Review — rationale and sources

Why `SKILL.md` says what it says. Written 2026-08-05 against branch
`refactor/architecture-plan-wave-0-3`. `PLAN.md` holds the fuller design
discussion this was distilled from.

## Why a hardcoded routing table

`skills-lock.json` is the obvious source of truth and it is the wrong one: it
disagrees with `.claude/skills/` in both directions — lock-only entries
(`architecture-patterns`, `github-workflow-automation`) and disk-only ones
(`mermaid-diagram`, `react-best-practices`, `react-testing-library`, `security`).
Recorded in root `INSIGHTS.md`, 2026-07-29. A router built on it would silently
skip real skills and try to load skills that do not exist.

The cost of hardcoding is drift as skills are added. That is bought back by the
`ls -d .claude/skills/*/` self-check in phase 4, which reports an unrouted skill
as `minor` — the table is allowed to be stale, but not silently stale.

The three deliberate exclusions are not oversights. `engineering-insights` and
`mermaid-diagram` describe how to *write* something (an insight entry, a
diagram); they encode no rule a diff can violate. `pr-self-review` routing itself
would be circular.

## Why skills see only their matched files

Two reasons, and the second is the one that actually bites:

1. **Cost** — loading the React skills for a backend-only PR is pure waste.
2. **False positives** — a skill handed the whole diff reviews files its rules
   were never written for. `onion-architecture` on a React component produces
   confident nonsense about layering.

`security` and `typescript-expert` are the exception because their rules genuinely
are full-stack: an injection path or an unsound cast is not a property of which
side of the repo a file sits on.

## Why the severity taxonomy is closed

The failure mode of every self-review gate is escalation: each skill considers its
own rules important, so everything becomes critical, so the verdict is always
`BLOCKED`, so people stop reading it. Defaulting skill-conformance findings to
`major` and enumerating a **closed** list for `critical` is what keeps `BLOCKED`
meaningful. If a new critical is needed, it gets added to that list explicitly —
it is never inferred.

The `file:line` requirement is borrowed from `engineering-insights`, for the same
reason: a finding you cannot navigate to is a finding nobody acts on.

## Why these seven invariants

Each one is a mistake this repo actively invites, documented in `CLAUDE.md`,
`TESTING.md`, or `INSIGHTS.md` — not generic review wisdom:

| # | Invariant | Source |
|---|---|---|
| 1 | shared-contract desync | root `INSIGHTS.md` 2026-07-29 — two physical copies, no sync script, mirror lags in 5 files |
| 2 | hand-edited migration | `CLAUDE.md` do-not-touch |
| 3 | schema without migration | drizzle-kit generates; a schema edit alone never reaches the DB |
| 4 | module not registered | `CLAUDE.md` — static registration in `server/src/modules/index.ts`, no autoload |
| 5 | ESM `.js` extension | `CLAUDE.md` — required in `server/`+`reviewer-core/`, forbidden in `client/` |
| 6 | secret in the diff | generic, but cheap and unrecoverable once pushed |
| 7 | integration test misnamed | `TESTING.md:79-82` — a DB-backed test without `*.it.test.ts` lands in the unit lane |

Invariant 7 was added while writing the skill; `PLAN.md` §5 listed six.

## Why not `pnpm test` in `server/`

It runs both lanes and needs Docker (`TESTING.md:69`). The gate uses the explicit
split instead — `pnpm exec vitest run --exclude '**/*.it.test.ts'` for the
hermetic lane, `pnpm exec vitest run .it.test` for the Docker one. CI invokes it
the same way and for a specific reason: `server/package.json` is `skip-worktree`,
so committed `test:unit` / `test:integration` scripts cannot be relied on
(`TESTING.md:83-86`).

The Docker-unavailable case is deliberately `WARN` and not a skip-in-silence. It
is also deliberately not `critical`: making it one would mean the gate is
bypassable by stopping Docker, which teaches exactly the wrong habit.

## State of the tooling this was written against

Verified on 2026-08-05, and worth re-checking if the gates start misbehaving:

| Package | Manager | `typecheck` | `lint` | `eslint.config.*` | `test` |
|---|---|---|---|---|---|
| `server/` | pnpm | yes | yes | yes (untracked) | both lanes — use the split |
| `client/` | pnpm | yes | yes | yes (untracked) | yes |
| `reviewer-core/` | npm | yes | yes | yes (untracked) | yes |
| `e2e/` | npm | yes | no | no | needs the full stack |

`server/` also has `pnpm arch` (`depcruise src ../reviewer-core/src`), which is
why one invocation covers both packages.

This corrects `PLAN.md` §4, written days earlier, which stated `client/` had no
eslint config and that `server/`'s `pnpm lint` would fail for lack of one. All
three configs now exist — untracked on this branch, so they are present locally
but absent for anyone who has not pulled them. The phase-2 rule that a missing
config is a *skipped gate, not a finding* is what makes the skill behave sanely
in both cases.

## `treeHash`

`PLAN.md` §8 proposed hashing `git status --porcelain`. That is too weak:
porcelain output lists names and statuses, so editing an already-modified file
further does not change the hash, and a stale `PASS` would survive real edits.
The skill hashes the diff *content* plus the hashed contents of untracked files
instead.

## Deliberate scope boundary

`/code-review` hunts bugs; this skill checks conformance. The overlap is real but
the outputs differ — `/code-review` answers "is this code correct", this answers
"does this code match how we agreed to build things here". Merging them would
produce a gate that is both slow and vague. When a diff needs bug-hunting, the
report should say so and point at `/code-review` rather than grow a phase for it.
