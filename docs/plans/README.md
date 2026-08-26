# Development Plans

A **plan** is the work breakdown for one change: what has to be true when it is done, and which
tasks get it there. The [implementation-planner](../../.claude/agents/implementation-planner.md) writes them; the
[implementer](../../.claude/agents/implementer.md) executes one task at a time, often several in
parallel. This file is the contract between the two — both agents cite it, so change it here rather
than in either agent. A change too small to earn a plan document skips the file entirely and is
dispatched as an **inline task block**: same block, same mandatory fields, same refusals — see
[Where a task block comes from](#where-a-task-block-comes-from).

A plan is **not** a spec, and there are two kinds of spec it is not:

| | Prescriptive | Descriptive |
|---|---|---|
| Path | `<package>/specs/SPEC-NN-<slug>.md` | `<package>/specs/<feature>.md` (no ID) |
| Written by | [`spec-creator`](../../.claude/agents/spec-creator.md), **before** the code | [`doc-writer`](../../.claude/agents/doc-writer.md), **after** it shipped |
| Says | what "done" means, as `AC-1..AC-n` | how the thing behaves today |

A plan is a snapshot of how to get from the first to the second, and it goes stale the moment the
work lands. **Where a prescriptive spec exists it is the plan's source of requirements** — the
planner restates its `AC-n` as `REQ-n` rather than inventing any — and the `**Spec:**` field below
names it. Neither spec is ever written or edited by the planner or an implementer.

## Naming

`docs/plans/NN-slug.md` — `NN` zero-padded, the next number after the highest already present:
`01-findings-severity-filter.md`, `02-repo-intel-reindex.md`.

## Document skeleton

~~~markdown
# Plan NN — <title>

**Modules:** server · client   **Created:** YYYY-MM-DD   **Status:** draft | in-progress | done
**Spec:** SPEC-NN — <link to `<package>/specs/SPEC-NN-<slug>.md`>, or `none`

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

**Where the plan came from a spec, each REQ names the `AC-n` it restates** — `REQ-3 (SPEC-04 AC-9):
a bad severity value is rejected with 422 before the handler runs.` That citation plus the matrix is
the whole traceability chain: criterion → requirement → task → acceptance box. It is worth the six
characters, because it is the only mechanical link between the two documents, and a `REQ` that cites
no `AC` when a spec exists is either scope the owner never agreed to or a citation somebody skipped.

## The task block

This is the real contract — and it is the contract wherever the block arrives from, a plan file or a
dispatch prompt. **Every field is mandatory** — a task missing one is invalid and must not be
dispatched.

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

**Inner loop:** `cd server && pnpm exec vitest run test/reviews-filter.test.ts --reporter=dot --silent`

**Done condition:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`
~~~

`Binding insights: none` is a valid value. An empty field is not.

**`Inner loop:` is the one optional field, and its absence has a defined meaning** — not a refusal.
A block without it is valid, and the implementer derives the command itself from its lane's row in
[Inner loop](#inner-loop--run-while-iterating-its-output-stays-inside-the-agent), substituting the
test file its own `Owned paths` list names. It is optional because every plan written before this
field existed is still dispatchable; it is worth writing anyway, because the planner knows which
file the task owns and can name it exactly. `Done condition:` stays mandatory and is unchanged.

**`Parallel:`** mirrors the task's row in §6: `yes` when siblings run alongside it, `no` when it is
the only task in its wave. It is informational for most tasks and load-bearing for exactly one case
— a task owning a **Tier B** path is refused unless it says `no`.

## Where a task block comes from

A task block reaches an implementer from one of **two sources**, and they are equal:

- **A plan file** — a task in `docs/plans/NN-*.md`, dispatched by reference: *"T3 from
  `docs/plans/04-smart-diff.md`"*.
- **An inline task block** — the same syntax as above, pasted straight into the dispatch prompt,
  for a change too small to earn a plan document.

**The block is the contract, not the file.** Every field above is mandatory in both. A block missing
one is invalid and must not be dispatched: inline is not a lighter mode, it is the same block
without a file around it, and the implementer refuses it either way.

What a plan file supplies that an inline block does not, and who picks it up instead:

| Supplied by the plan | Who owns it inline |
|---|---|
| §6's coverage matrix and the recorded disjointness check | **The dispatching session.** Fanning out two inline blocks at once means verifying their `Owned paths` are disjoint *before* dispatching — there is no §6 to record the check in, and the ownership invariant below is not relaxed by the absence of a document. |
| §3's insight synthesis | The block's own `Binding insights` field. `none` is valid; an empty field is not. |
| The `Created` date the conflict rule keys on | A `**Dispatched:** YYYY-MM-DD` line in the block. Without one, the implementer treats every `INSIGHTS.md` entry as newer than the block. |

`Wave:` and `Depends on:` are meaningful only inside a plan's task graph; inline they may read
`n/a`. **`Parallel:` may not** — it is load-bearing for the Tier B rule below, so it stays mandatory
in both sources.

### Extraction is the preferred way to dispatch a plan's task

Dispatching *"T3 from `docs/plans/04-smart-diff.md`"* makes the implementer open the whole plan to
find one block. The plans in this repo run 21k–44k tokens; a task block runs about 2k. The agent
pays the whole file to read 5% of it, once per task — sixteen times over on plan 04.

So the default is: **the dispatching session extracts the block and pastes it verbatim.** Task
headings are `^### T<n> —`, so the extraction is mechanical. Two things must survive it:

- **`**Dispatched:** YYYY-MM-DD` carrying the plan's own `Created:` value** — not today's date.
  That field is what the conflict rule below keys on, and the plan's date is when the task was
  actually authored, so copying it preserves "an entry newer than the block wins" exactly. Omit
  the field and the implementer treats *every* `INSIGHTS.md` entry as newer than the task.
- **A provenance line**, so the block is still traceable and the escape hatch stays open:
  `Task source: T3 of docs/plans/04-smart-diff.md, reproduced verbatim below — do not open the
  plan unless a mandatory field is missing from this block.`

Nothing else is lost, because nothing else was being used: §3's insight synthesis is already
pushed down into the block's `Binding insights`, and §6's coverage matrix is the dispatching
session's to read, not the implementer's. Dispatch by reference remains correct — it is simply the
expensive way to say the same thing, and it is the right choice when a block turns out to be
malformed and somebody has to look at the plan anyway.

## Skills per lane

**Both agents preload the same twelve skills** — the implementation-planner because it assigns them, the
implementer because it applies them. That is deliberate: a plan whose `Skills` line was chosen
without knowing what is inside the skill produces tasks the implementer has to re-scope. This table
is the source of truth for the `Skills` field; both agent files carry a copy of it.

| Lane | Trigger path | Governing skills |
|---|---|---|
| contract | `server/src/vendor/shared/**` | `zod` — plus `onion-architecture`'s R0 rule: contracts import `zod` and nothing else |
| backend | `server/src/**` | `onion-architecture`, `fastify-best-practices`, `zod`, `typescript-expert`; **+** `drizzle-orm-patterns` and `postgresql-table-design` for `db/**` or any `repository*`; **+** `security` for auth, untrusted input, secrets, uploads |
| frontend | `client/src/**` | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `typescript-expert`; **+** `react-testing-library` for any `*.test.tsx`; **+** `zod` for forms and parsing |
| engine | `reviewer-core/src/**` | `typescript-expert`, `zod`; **+** `security` on prompt-assembly and injection paths |
| mcp | `mcp/**` | `onion-architecture` — **as scoped by `mcp/specs/mcp-server.md`**, which is the package's own ring model and import matrix; `typescript-expert`; `zod`; **+** `security` on the tool boundary and any interpolated URL; **+** `context7-mcp` for the MCP TypeScript SDK's current API. **Never** `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design` (no HTTP server, no database ring), nor any of the four UI skills |
| e2e | `e2e/**` | none of the twelve — `e2e/AGENTS.md` governs |
| process | **New** `.claude/agents/<name>.md` and `.claude/skills/<name>/SKILL.md`; plus the two catalogs `.claude/agents/README.md` and `.claude/skills/README.md` (Tier B — solo wave). Editing an **existing** agent or skill is Tier A and never a task | none of the twelve — `.claude/agents/README.md` §"Adding a new agent" and `.claude/skills/README.md` §"Creating New Skills" govern |

The `process` lane covers two kinds of work: **creating** an agent or skill file that does not exist
yet — ordinary, parallelizable, see "Neither tier" below — and **editing** one of the two catalogs,
which is Tier B and needs a solo wave. It does not cover *editing* an existing agent or skill; that
is Tier A and never a task. A `process` task that edits anything other than the two catalogs is a
planning error.

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
overwrites the first. The implementation-planner verifies disjointness before emitting and records the check in §6;
the implementer refuses to touch anything outside its own list. Dispatched inline there is no §6 and
no implementation-planner, so **the dispatching session runs the check itself** before it fans out — the invariant
is unchanged, only its bookkeeper is.

**Disjointness is necessary and not sufficient.** It stops two agents *writing* the same file. It
does nothing about a sibling *reading* a file you are halfway through rewriting — two tasks can own
strictly disjoint paths while one rewrites `tsconfig.json` and the other typechecks against it. That
is why the cross-cutting files sit in Tier A rather than being handed out under the invariant, and
why a task owning a **Tier B** path must additionally be the only task in its wave.

## Protected paths

Two tiers, and they are not interchangeable. **Tier A cannot be fixed by a plan** — a plan, or a
dispatch prompt, that assigns one is wrong, and the third column names the task that should have
been written instead. **Tier B can** — it needs isolation, not prohibition.

Neither tier is relaxed by dispatching inline. Losing the plan document loses the coverage matrix
and the recorded disjointness check, nothing else: "no plan file" never means "no rules".

Each row is absolute for *its own* reason. Reading them as one blanket rule is what produces a
`BLOCKED` report that says "not allowed" without saying what to do.

### Tier A — never, plan or no plan

The implementation-planner may not put these in any `Owned paths` list, and the implementer refuses them **even
when a plan — or the prompt that dispatched it — names one**.

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
| **This file** — `docs/plans/README.md` | It is the contract both agents defer to and carry copies of. Editing it mid-wave changes the law under tasks that are already running, and the implementer checking its own tier list would be reading a different document than the implementation-planner that wrote the task. | A `[parent session]` step, between waves — never during one |

### Tier B — exclusive: assignable, never concurrent

| Path | Why it is not Tier A | Condition |
|---|---|---|
| `.claude/agents/README.md`, `.claude/skills/README.md` | These catalogs *describe* the set; they do not *govern* behaviour. Editing one changes no rule anybody works by. | The owning task must be **alone in its wave**: `**Parallel:** no` in the task block, and `Parallel? = no` on its row in §6. Dispatched inline, the block still states `**Parallel:** no` and the dispatching session runs it alone — the marker is the condition, the §6 row is only its record |

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

A task carries **two** commands, and they answer different questions. The **inner loop** is what
the implementer iterates against while it is still writing code; the **final proof** is what it
runs once, at the end, and pastes into its report. The implementation-planner writes both fields
into the task block, copying each from the matching row below. These tables are the source of truth.

### Final proof — run once; its output is the report's evidence

| Lane | Command |
|---|---|
| backend (hermetic) | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| backend (DB-backed) | `cd server && pnpm typecheck && pnpm exec vitest run .it.test` — needs Docker; the test file **must** end `.it.test.ts` |
| frontend | `cd client && pnpm typecheck && pnpm test` |
| engine | `cd reviewer-core && npm run typecheck && npm test` — typecheck **is** the build; the package never emits JS |
| contract | `./scripts/sync-vendor.sh && ./scripts/sync-vendor.sh --check && cd server && pnpm typecheck && cd ../client && pnpm typecheck` |
| mcp | `cd mcp && npm run typecheck && npm test` — one hermetic lane, no Docker and no `.it` split, because the package has no persistence ring |
| e2e | `cd e2e && npm run typecheck` — `npm run e2e:hermetic` is bash-only (Git Bash/WSL on Windows) |
| process | `n/a` — markdown has no typecheck and no test lane |

The package managers differ: **pnpm** for `server/` and `client/`, **npm** for `reviewer-core/`,
`e2e/` and `mcp/`. There is no root `package.json`; every command runs from inside its package.

### Inner loop — run while iterating; its output stays inside the agent

`<own test file>` is the test file **this task owns**, from its `Owned paths` list — not a glob,
not the package.

| Lane | Command |
|---|---|
| backend (hermetic) | `cd server && pnpm exec vitest run <own test file> --reporter=dot --silent` |
| backend (DB-backed) | `cd server && pnpm exec vitest run <own .it.test.ts file> --reporter=dot --silent` |
| frontend | `cd client && pnpm exec vitest run <own test file> --reporter=dot --silent` |
| engine | `cd reviewer-core && npm exec -- vitest run <own test file> --reporter=dot --silent` |
| mcp | `cd mcp && npm exec -- vitest run <own test file> --reporter=dot --silent` |
| contract | none — the lane owns no test file of its own; run the final proof directly |
| e2e | none — `npm run typecheck` is already the whole check |
| process | `n/a` |

**Neither flag can hide a failure.** Probed 2026-08-25 against vitest 2.1.9: on a failing
assertion the command still exits non-zero and still prints the full `AssertionError`, the
expected/received diff and the code frame. `--reporter=dot` collapses only the per-file *pass*
listing — roughly fifty lines down to two on `server/` — and `--silent` suppresses `console.log`
from the code under test, which is usually the bulk of the noise.

Why the split exists: the final-proof command typechecks and runs the whole package, so an
implementer that loops on it pays for a full `tsc` plus every test file in the package on every
iteration, and then has to read its siblings' in-flight errors to attribute them. The inner loop
narrows both — fewer tokens spent, and almost nothing to attribute, because the only file in the
run is one the task owns.

**The inner loop never substitutes for the final proof.** Green in the inner loop is not `DONE`;
the report's `Done condition` fence carries the final-proof command and its output, always. An
implementer that pastes an inner-loop run there has proved the narrower thing and claimed the
wider one.

**`n/a` is not "skip the check" — it is a different check.** Every other lane proves itself with a
command whose output the implementer pastes verbatim. The `process` lane has no such command, so the
proof moves to the `Acceptance` boxes: each one is closed by **quoting the file content that
satisfies it**, and a box closed by assertion rather than quotation is not closed. The implementer
may not invent a command to fill the gap — a command the agent chose itself proves nothing, because
it was chosen to pass.

## How INSIGHTS.md reaches the implementer

Two passes with different jobs. **Neither agent reads all four logs.**

| | Implementation planner (once per plan) | Implementer (once per task) |
|---|---|---|
| **Reads** | every touched module's `INSIGHTS.md`, in full | **exactly one** — its own lane's module |
| **Job** | *synthesis* — what does this whole change need to know? | *freshness* — has anything landed since the plan was written? |
| **Emits** | §3 `Insights consulted`, then pushes the relevant dated entries down into each task's `Binding insights` | `**Insights read:**` in its report, naming what bound the task |

**With no plan, the synthesis pass has no owner.** An inline dispatch skips the left-hand column
entirely, so the dispatching session either quotes the binding entries into the block's
`Binding insights` itself or writes `none` — and in that case the implementer's own-module read is
the *only* pass over any `INSIGHTS.md`. That is a real narrowing, and it is the price of skipping the
plan: fine for a single-module change, not fine for one that spans modules the implementer will
never read.

The implementer's pass is not redundant with the plan. The root `AGENTS.md` protocol requires
whoever works in a module to read that module's log and summarize it before writing code — the plan
cannot discharge that obligation on the implementer's behalf. It also covers the two cases the
implementation-planner structurally cannot see: an entry appended *after* the plan was written, and a gotcha that
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

## After the waves land

Implementers do not review their own work. What happens once the last wave is in belongs to the
dispatching session, and it runs in this order:

1. **Coverage triage — free, and first.** The session holds every implementer report and §6 is on
   disk. Cross them: every `REQ` in the matrix is claimed by at least one report whose verdict is
   `DONE`; no report is `BLOCKED` or `PARTIAL` with an unticked acceptance box; every
   `Notes for the integrator` entry is actioned or recorded. This costs one read and no dispatch,
   and it is deliberately *before* the expensive passes — finding a requirement nobody implemented
   after paying for a structural review and a round of test writing is the failure this step exists
   to prevent.
2. **`architecture-reviewer`** over the whole diff. Structure only — its scope table is explicit
   that correctness and vulnerabilities are not its question.
3. **Remediation** of what it found — see below.
4. **`test-writer`, only at the targets triage flagged as untested.** It is a gap-filler, not a
   phase: every implementer already writes its lane's tests (`implementer.md`, Method step 5), and
   `test-writer`'s RED proof temporarily mutates the file under test. On the dirty tree implementers
   leave behind, that mutation cannot be undone with git — it restores from bytes held in the
   agent's own context — so `G6`, a half-mutated source file left on disk, is the worst outcome
   available anywhere in this agent set. Every target that did not need covering is one more walk
   down that path for nothing.
5. **`plan-verifier`** last, and it has to be last: inspection caps at `PARTIAL` in its contract, so
   only a passing test buys `VERIFIED`. Run before step 4 it grades every uncovered requirement
   `PARTIAL` and returns `INCOMPLETE` by construction.
6. **Remediation** of what *it* found.

**`pr-self-review` is not in this list, and neither is a commit.** That gate is slow and it is the
owner's to spend — it runs once, by hand, when the owner judges the diff ready. No agent commits,
stages, or checks anything out, and neither does the dispatching session on its own initiative:
git state is the owner's call at every point in this workflow.

## Remediation — who fixes what a reviewer found

`architecture-reviewer` and `plan-verifier` are read-only by allowlist and by design. Neither fixes
anything, so without this step their findings live in a chat transcript and are actioned by hand or
not at all.

**The dispatching session turns each finding into an inline task block and dispatches an
`implementer`.** A finding already carries most of one: `architecture-reviewer` gives `file:line`
plus the violated rule quoted verbatim, `plan-verifier` gives the `REQ` and the evidence it could
not find. The session supplies the rest.

~~~markdown
### FIX-1 — <the finding, in one line>
**Wave:** n/a · **Parallel:** no · **Lane:** backend · **Depends on:** n/a
**Dispatched:** YYYY-MM-DD
**Source finding:** `architecture-reviewer` — CRITICAL, `server/src/modules/x/service.ts:12`
**Implements:** REQ-4 (re-open) | n/a — structural only

**Owned paths (exclusive):**
- `server/src/modules/x/service.ts` (edit)

**May read:** `server/src/modules/x/repository.ts`

**Skills (mandatory):** `onion-architecture`, `typescript-expert`

**Binding insights:** none

**Do:** <what the fix is, as intent — 1-3 sentences>

**Acceptance:**
- [ ] <the finding's own words, restated as a checkable fact about the code>

**Red flags:**
- [ ] <the mistake this particular fix invites>

**Inner loop:** `cd server && pnpm exec vitest run <the covering test> --reporter=dot --silent`
**Done condition:** `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'`
~~~

Two rules carry over unchanged. Fix blocks fanned out together are a wave: **check their
`Owned paths` are disjoint before dispatching**, because there is no §6 to record the check in.
And a finding that lands on a **Tier A** path is not a fix block at all — it is a `[parent session]`
step, and the replacement action comes from the "Do this instead" column above.

A finding the session decides **not** to fix is recorded with the reason, not silently dropped. An
unfixed `CRITICAL` that nobody wrote down reads exactly like one nobody found.
