# Development Plans

A **plan** is the work breakdown for one change: what has to be true when it is done, and which
tasks get it there. The [planner](../../.claude/agents/planner.md) writes them; the
[implementer](../../.claude/agents/implementer.md) executes one task at a time, often several in
parallel. This file is the contract between the two — both agents cite it, so change it here rather
than in either agent.

A plan is **not** a spec. `<package>/specs/<feature>.md` describes a feature durably and stays in
sync with the code; a plan is a snapshot of intent that goes stale the moment the work lands. Link
the spec from the plan when one exists.

## Naming

`docs/plans/NN-slug.md` — `NN` zero-padded, the next number after the highest already present:
`01-findings-severity-filter.md`, `02-repo-intel-reindex.md`.

## Document skeleton

~~~markdown
# Plan NN — <title>

**Modules:** server · client   **Created:** YYYY-MM-DD   **Status:** draft | in-progress | done
**Spec:** <link to `<package>/specs/<x>.md`, or `none`>

## 1. Goal
## 2. Requirements          <- REQ-1..REQ-n, each one testable sentence
## 3. Insights consulted    <- proof of the AGENTS.md session protocol
## 4. Contract changes      <- wave 0, or "none"
## 5. Architecture          <- mermaid, only when the change is non-obvious
## 6. Task graph            <- waves table + Requirement -> Task coverage matrix
## 7. Tasks                 <- T1..Tn
## 8. Done condition        <- the command set that proves the whole plan landed
## 9. Risks & open questions
~~~

### Requirements carry IDs

One testable sentence each — `REQ-3: a bad severity value is rejected with 422 before the handler
runs.` Every REQ must appear in at least one task's Acceptance, and §6 holds the coverage matrix, so
a requirement nobody implemented is visible on the page rather than discovered at review time:

| | REQ-1 | REQ-2 | REQ-3 |
|---|---|---|---|
| T1 | x | | |
| T3 | | x | x |

## The task block

This is the real contract. **Every field is mandatory** — a task missing one is invalid and must not
be dispatched.

~~~markdown
### T3 — Add findings severity filter endpoint
**Wave:** 2 · **Parallel:** yes · **Lane:** backend · **Ring:** R2+R5 · **Depends on:** T1
**Implements:** REQ-2, REQ-3

**Owned paths (exclusive — no other task may name these):**
- `server/src/modules/reviews/service.ts` (edit)
- `server/src/modules/reviews/routes.ts` (edit)
- `server/test/reviews-filter.test.ts` (new)

**May read:** `server/src/vendor/shared/contracts/findings.ts`, `modules/reviews/repository.ts`

**Skills (mandatory — these govern this task, from the lane table below):**
`onion-architecture`, `fastify-best-practices`, `zod`, `typescript-expert`

**Binding insights** (quoted from `server/INSIGHTS.md` so the implementer need not re-derive them):
- `2026-08-14` — widening a contract enum is 3 edits and 0 migrations
- `2026-08-11` — a `.default()` on a request schema silently masks a missing field in real calls

**Do:** <2-5 sentences of intent, not code>

**Acceptance:**
- [ ] REQ-2 — `GET /reviews/:id/findings?severity=high` returns only high findings
- [ ] REQ-3 — a bad enum returns 422 from the route schema, before the handler body runs

**Red flags (stop if you are about to do any of these):**
- [ ] importing `drizzle-orm` or `db/schema*` into `service.ts`
- [ ] passing `app.container` to the service instead of an explicit `Deps`
- [ ] hand-rolling `.parse()` in the handler instead of a route schema

**Done condition:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`
~~~

`Binding insights: none` is a valid value. An empty field is not.

**`Parallel:`** mirrors the task's row in §6: `yes` when siblings run alongside it, `no` when it is
the only task in its wave. It is informational for most tasks and load-bearing for exactly one case
— a task owning a **Tier B** path is refused unless it says `no`.

## Skills per lane

**Both agents preload the same twelve skills** — the planner because it assigns them, the
implementer because it applies them. That is deliberate: a plan whose `Skills` line was chosen
without knowing what is inside the skill produces tasks the implementer has to re-scope. This table
is the source of truth for the `Skills` field; both agent files carry a copy of it.

| Lane | Trigger path | Governing skills |
|---|---|---|
| contract | `server/src/vendor/shared/**` | `zod` — plus `onion-architecture`'s R0 rule: contracts import `zod` and nothing else |
| backend | `server/src/**` | `onion-architecture`, `fastify-best-practices`, `zod`, `typescript-expert`; **+** `drizzle-orm-patterns` and `postgresql-table-design` for `db/**` or any `repository*`; **+** `security` for auth, untrusted input, secrets, uploads |
| frontend | `client/src/**` | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `typescript-expert`; **+** `react-testing-library` for any `*.test.tsx`; **+** `zod` for forms and parsing |
| engine | `reviewer-core/src/**` | `typescript-expert`, `zod`; **+** `security` on prompt-assembly and injection paths |
| e2e | `e2e/**` | none of the twelve — `e2e/AGENTS.md` governs |
| process | `.claude/agents/**`, `.claude/skills/**` | none of the twelve — `.claude/agents/README.md` §"Adding a new agent" and `.claude/skills/README.md` §"Creating New Skills" govern |

The `process` lane exists only because Tier B made two files assignable. Almost everything it could
name is Tier A, so a `process` task that is not one of the two catalogs is a planning error, not a
new capability.

A lane must not be assigned a skill from another lane's stack: a `client/` task citing
`onion-architecture` or a `server/` task citing `next-best-practices` is a defect in the plan, and
the implementer's lane row wins over it. A plan **may** name a skill outside the twelve
(`mermaid-diagram`, `pr-self-review`, anything under `.claude/skills/`); the implementer loads it
at runtime with the `Skill` tool. In that direction — and only that one — the plan outranks the
preload list.

## The ownership invariant

**The union of every `Owned paths` list within a wave must be disjoint.**

Implementers share one working tree — there is no worktree isolation. So two tasks in the same wave
naming the same file is not a style problem, it is lost work: whichever agent writes second
overwrites the first. The planner verifies disjointness before emitting and records the check in §6;
the implementer refuses to touch anything outside its own list.

**Disjointness is necessary and not sufficient.** It stops two agents *writing* the same file. It
does nothing about a sibling *reading* a file you are halfway through rewriting — two tasks can own
strictly disjoint paths while one rewrites `tsconfig.json` and the other typechecks against it. That
is why the cross-cutting files sit in Tier A rather than being handed out under the invariant, and
why a task owning a **Tier B** path must additionally be the only task in its wave.

## Protected paths

Two tiers, and they are not interchangeable. **Tier A cannot be fixed by a plan** — a plan that
assigns one is wrong, and the third column names the task that should have been written instead.
**Tier B can** — it needs isolation, not prohibition.

Each row is absolute for *its own* reason. Reading them as one blanket rule is what produces a
`BLOCKED` report that says "not allowed" without saying what to do.

### Tier A — never, plan or no plan

The planner may not put these in any `Owned paths` list, and the implementer refuses them **even
when a plan names one**.

| Path | Why | Do this instead |
|---|---|---|
| `pnpm-lock.yaml`, `package-lock.json` | Regenerated by the package manager only. A hand-edited lockfile is a broken artifact no matter who edits it or when (root `AGENTS.md`). | A `[parent session]` `pnpm install` / `npm install` step |
| `server/src/db/migrations/**` | Generated by `drizzle-kit generate`; hand-editing desyncs `meta/`. | A task on `db/schema/**` **plus** a `[parent session]` generate step |
| `client/src/vendor/shared/**` | A byte-identical mirror. `client.yml` runs `sync-vendor.sh --check` as its first, blocking step, so a direct edit fails CI before anything else runs. | Edit the server copy, then a `[parent session]` `./scripts/sync-vendor.sh` |
| Existing files under `server/src/vendor/shared/contracts/**` | The barrel is stable — feature work **extends** it with new files, it does not edit existing ones. | A new contract file, in wave 0 |
| Root configs — `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `next.config.*`, `docker-compose.yml`, `.gitignore`, any `package.json` | Cross-cutting: one implementer changing them breaks every parallel sibling. And **`server/package.json` is `skip-worktree`** ([TESTING.md](../../TESTING.md)) — an edit there is invisible to `git status` and is lost silently. | A `[parent session]` step in wave 0 |
| Any `INSIGHTS.md` | An append-only log whose writer is defined by the `engineering-insights` protocol: the parent session, at session end. Concurrent appends from parallel siblings collide, and there is no conflict marker. | An `### Insight candidates` section in the report |
| `AGENTS.md`, `CLAUDE.md`, `.claude/settings*.json`, `.claude/hooks/**` | The law you are governed by, and the permission and hook layer that constrains you. An agent rewriting its own constraints is the one edit no review can be trusted to catch, because the reviewer runs under the rewritten constraints. | A `[parent session]` step |
| **Existing** files under `.claude/agents/*.md` and `.claude/skills/**/SKILL.md` | Same reason, narrower: these are rules already in force over you and your siblings. Editing one changes how work already in flight behaves. | A `[parent session]` step |

### Tier B — exclusive: assignable, never concurrent

| Path | Why it is not Tier A | Condition |
|---|---|---|
| `.claude/agents/README.md`, `.claude/skills/README.md` | These catalogs *describe* the set; they do not *govern* behaviour. Editing one changes no rule anybody works by. | The owning task must be **alone in its wave**: `**Parallel:** no` in the task block, and `Parallel? = no` on its row in §6 |

Work that genuinely needs a Tier A path becomes a serialized **`[parent session]`** step in wave 0,
not an implementer task — and the plan names the *replacement action*, not the file.

### Neither tier — a **new** file under `.claude/agents/` or `.claude/skills/`

Creating an agent or a skill that **does not yet exist** is ordinary work, owned and dispatched like
any source file, under plain disjoint ownership and with no solo-wave requirement. Four new agent
files are four parallel tasks.

The distinction is not cosmetic. "An agent must not change its own rules" is a statement about rules
**already in force**: editing `implementer.md` changes how every in-flight sibling behaves, and the
agent making the edit is one of them. Creating `test-writer.md` changes nobody's rules — the file
governs nothing until someone dispatches it. Collapsing the two is what made `implementer` refuse
work that carried no risk at all.

A task that creates a new agent file and a task that edits an existing one are therefore different
lanes, and a plan that assigns the second is wrong no matter how it is marked.

## Done-condition commands

The planner copies the matching row into each task verbatim. This table is the source of truth.

| Lane | Command |
|---|---|
| backend (hermetic) | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| backend (DB-backed) | `cd server && pnpm typecheck && pnpm exec vitest run .it.test` — needs Docker; the test file **must** end `.it.test.ts` |
| frontend | `cd client && pnpm typecheck && pnpm test` |
| engine | `cd reviewer-core && npm run typecheck && npm test` — typecheck **is** the build; the package never emits JS |
| contract | `./scripts/sync-vendor.sh && ./scripts/sync-vendor.sh --check && cd server && pnpm typecheck && cd ../client && pnpm typecheck` |
| e2e | `cd e2e && npm run typecheck` — `npm run e2e:hermetic` is bash-only (Git Bash/WSL on Windows) |
| process | `n/a` — markdown has no typecheck and no test lane |

The package managers differ: **pnpm** for `server/` and `client/`, **npm** for `reviewer-core/` and
`e2e/`. There is no root `package.json`; every command runs from inside its package.

**`n/a` is not "skip the check" — it is a different check.** Every other lane proves itself with a
command whose output the implementer pastes verbatim. The `process` lane has no such command, so the
proof moves to the `Acceptance` boxes: each one is closed by **quoting the file content that
satisfies it**, and a box closed by assertion rather than quotation is not closed. The implementer
may not invent a command to fill the gap — a command the agent chose itself proves nothing, because
it was chosen to pass.

## How INSIGHTS.md reaches the implementer

Two passes with different jobs. **Neither agent reads all four logs.**

| | Planner (once per plan) | Implementer (once per task) |
|---|---|---|
| **Reads** | every touched module's `INSIGHTS.md`, in full | **exactly one** — its own lane's module |
| **Job** | *synthesis* — what does this whole change need to know? | *freshness* — has anything landed since the plan was written? |
| **Emits** | §3 `Insights consulted`, then pushes the relevant dated entries down into each task's `Binding insights` | `**Insights read:**` in its report, naming what bound the task |

The implementer's pass is not redundant with the plan. The root `AGENTS.md` protocol requires
whoever works in a module to read that module's log and summarize it before writing code — the plan
cannot discharge that obligation on the implementer's behalf. It also covers the two cases the
planner structurally cannot see: an entry appended *after* the plan was written, and a gotcha that
only becomes relevant once you are inside the code.

**Conflict rule.** Entries are dated and append-only. If an entry is newer than the plan's `Created`
date and contradicts the task, **the insight wins** — implement per the insight and record the
divergence under `Notes for the integrator` so the plan gets corrected. The plan is a snapshot; the
log is the running truth.

**When the logs outgrow this** — rule of thumb, a module's `INSIGHTS.md` past ~400 lines — the
per-task `Binding insights` field becomes the primary channel and the implementer's full read
narrows to a targeted `Grep` over its owned paths' subject matter. Written down here so the switch
is a known step rather than a future rediscovery.

## Shared-checkout rules

Every implementer works in the session's own checkout and branch. Three consequences:

- **Waves need no commit between them.** A wave-1 implementer sees wave 0's edits directly. This is
  the main benefit of not isolating into worktrees.
- **Typecheck spans the whole package and will surface siblings' in-flight edits.** An implementer
  attributes failures by path: errors inside its owned paths are its own to fix; errors elsewhere
  are reported as *sibling in-flight / pre-existing* and never "fixed" by reaching outside its lane.
  Expect reports that are green-in-lane and red overall while a wave is still running.
- **`db:migrate`, `db:seed`, and a `client/` build are parent-session actions**, never an
  implementer's — they mutate shared state, and `pnpm build` while `pnpm dev` is running breaks the
  dev server (`client/INSIGHTS.md`).

## Review

Implementers do not review their own work and do not run `pr-self-review`. The parent session runs
it **once**, over the whole diff, after every wave has landed — N partial reviews over N partial
diffs would each miss the cross-task interactions that are exactly what needs reviewing.
