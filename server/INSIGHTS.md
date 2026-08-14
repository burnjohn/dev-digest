# Insights — server

Server-side decisions and dead ends. Read before redesigning anything here; a
lot of what looks arbitrary was a deliberate trade-off.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here. Insights about `src/vendor/shared/` go in the **root** `INSIGHTS.md` —
a contract change reaches every package.

---

## Decisions

### 2026-07-31 — Schema-first validation at the route boundary

**What:** every route declares Zod `params`/`body`/response schemas from
`@devdigest/shared` via `fastify-type-provider-zod`; invalid input is rejected
with `422` before the handler runs.
**Why:** one definition has to drive both request validation and response
serialization, or the two drift.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside each handler — it
validated input only, left responses unchecked, and duplicated the schema
reference in every route.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-14** — every package sets `noUncheckedIndexedAccess: true`, so the
  `const [row] = await db.insert(...).returning()` idiom types `row` as
  `Row | undefined` and used to be closed with `row!` in five places
  (`modules/agents/repository.ts`, `modules/repos/repository.ts`,
  `modules/reviews/repository/review.repo.ts`,
  `modules/reviews/repository/run.repo.ts`, `platform/jobs.ts`). `!` is banned
  (`@typescript-eslint/no-non-null-assertion`, `eslint.config.js`); the settled
  shape is `if (!row) throw new Error('insert into <table> returned no row')`,
  a plain `Error` (→ 500) and **not** `NotFoundError`, because a single-row
  `INSERT ... RETURNING` yielding nothing is a broken invariant, not a missing
  resource. Copy that line when adding a new repo insert.
  `server/src/modules/repos/repository.ts:55`

- **2026-08-04** — `agent_runs` counters (`findings_count`, `blockers`, and now
  `critical_count`/`warning_count`/`suggestion_count`) are denormalized onto the
  run row once, at run completion in `run-executor.ts`, and never recomputed —
  even after a finding is later accepted/dismissed. This is intentional: the
  timeline shows the deterministic CI-gate snapshot, not a live view. A new
  per-severity/per-status counter on a run belongs in this same
  compute-once-at-write-time path (new column + migration), not a read-time
  `JOIN`/`GROUP BY` over `findings` — the latter would silently diverge from
  `blockers`' semantics (gate-tripped at run time vs. currently-live findings).
  `server/src/modules/reviews/run-executor.ts:238` (blockers/counts computed),
  `server/src/modules/reviews/repository/run.repo.ts:40` (read path, no
  aggregation query).
  **Qualified 2026-08-07:** that rule is about *per-run* counters. The PR
  **list**'s FINDINGS column deliberately does the opposite — a read-time
  aggregation over `findings` filtered by `isNull(dismissedAt)`, scoped to the
  latest `reviews` row. Three reasons the snapshot could not be reused: it is
  frozen at completion so it still counts dismissed findings; `agent_runs` has
  no FK to `reviews` (see `contracts/trace.ts`) so it cannot be scoped to the
  latest review at all; and the list embeds the finding rows for a hover popup,
  so a badge sourced from the snapshot would read "3" above a 2-row popup.
  Consequence to expect, not to "fix": after a dismissal the list's counts and
  the run timeline's counts legitimately disagree — live view vs. CI-gate
  snapshot. `server/src/modules/pulls/routes.ts` (findings block),
  `server/test/pulls-findings.it.test.ts`.

- **2026-08-04** — `ReviewRepository` in `repository.ts` re-declares each repo
  function's params type inline instead of importing it from the
  `repository/*.repo.ts` module that owns it (e.g. `completeAgentRun`'s
  `values` shape is written out twice: `repository.ts:153` and
  `repository/run.repo.ts:148`). Adding a field to one and not the other
  type-errors immediately at the call site, but only because both call sites
  happen to be typechecked in the same `tsc` run — it is easy to touch only one
  copy and get a real but confusing error pointing at the *caller*, not the
  missing field.

- **2026-08-07** — the `routes.ts → service.ts → repository.ts` layering is a
  convention, not something enforced: 4 of 8 feature modules —
  `modules/pulls/routes.ts`, `modules/polling/routes.ts`,
  `modules/settings/routes.ts`, `modules/workspace/routes.ts` — have no
  `service.ts`/`repository.ts` at all and query Drizzle + hold business logic
  directly in the route handler. The `dependency-cruiser` dep in `package.json`
  is not a self-lint — it only analyzes *other people's* cloned repos for the
  product feature. Treat those four as a documented exception (see
  `.claude/skills/onion-architecture/SKILL.md`), not something to fix as a
  drive-by — but apply the full split to any new module.
  **Enforced 2026-08-14:** `no-restricted-imports` in `server/eslint.config.js`
  now bans `drizzle-orm` and `db/schema` from every `src/modules/*/routes.ts`
  and `service.ts`, and `pnpm lint` gates it in `server-unit.yml`. The four
  legacy modules are exempted by an explicit `files:` list in that config
  rather than by loosening the rule, so the exception stays countable — that
  array should only ever get shorter. The other four modules were already
  clean when the gate went in; this codified reality, it did not force a
  refactor. `server/eslint.config.js`

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

- **2026-08-14** — a repository *update* that returns `Row | undefined` is
  signalling a real read-modify-write race, not type noise, and asserting it
  away turns a 404 into a 500. `actOnFinding` checked existence via
  `repo.findingContext(findingId)` and then wrote
  `findingRowToDto(row!)` on the result of `setFindingAccepted` /
  `setFindingDismissed` — if the finding was deleted in that gap the `UPDATE`
  matched zero rows and the route 500'd on `Cannot read properties of
  undefined`. Fix is `if (!row) throw new NotFoundError('Finding not found')`;
  `app.ts`'s error handler maps any `AppError.statusCode` straight through, so
  that is the only thing needed for a 404. Assume the same gap in any
  `lookup-then-update` pair here. `server/src/modules/reviews/findings.ts:25`

## Open Questions

_None yet._
