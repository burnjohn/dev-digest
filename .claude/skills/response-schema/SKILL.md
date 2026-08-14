---
name: response-schema
description: >-
  Guardrails for changing the TYPE or REQUIREDNESS of a field that already
  exists in an API response — i.e. editing an existing `@devdigest/shared`
  contract, not designing a new schema (see the `zod` skill for that). Use
  when a field moves optional→required, required→optional, or its Zod type
  changes, because that one edit ripples through the Drizzle column, the
  row→DTO adapter, the Fastify route's response schema, the client's
  vendored contract mirror (no sync script exists), and every consumer that
  assumed the old shape. Trigger terms: "change response shape", "make this
  field required", "make this field optional", "change field type",
  "breaking API change", "contract change".
version: 1.0.0
---

# Response Schema Changes

This skill is about **changing** a field that already exists in an API
response — not about designing a schema from scratch (`zod`) or modeling a
new table (`drizzle-orm-patterns`, `postgresql-table-design`).

## When to Use

- A field moves from `optional()` to required, or the reverse.
- A field's Zod type changes (e.g. `z.string()` → `z.number()`,
  `z.string()` → an enum).
- A **new required** field is added to an existing response type — this is
  optional→required in disguise: every already-persisted row needs a value.

## Why this is riskier than it looks

`@devdigest/shared` is vendored **twice** — `server/src/vendor/shared/`
(canonical) and `client/src/vendor/shared/` (mirror) — with **no sync
script** between them. Root `INSIGHTS.md` (2026-08-04, gated 2026-08-14)
documents this drifting for real: the client's copy of `adapters.ts` fell a
generation behind (missing `CommitFile`, `commitFiles()`, and the
`'openrouter'` provider enum), and **both packages typechecked green the
whole time** — a missing/stale field on one side of a duplicated file does
not fail typecheck on its own. `scripts/check-contracts.sh` now gates this in
CI (`client.yml`, `server-unit.yml`), but it only catches drift *between the
two copies* — it says nothing about whether every consumer of the changed
field was actually updated.

## The ripple checklist (order matters)

1. Edit the Zod schema in `server/src/vendor/shared/contracts/*.ts`
   **first** — the server copy is canonical.
2. Hand-mirror the same edit in `client/src/vendor/shared/contracts/*.ts`,
   then run `./scripts/check-contracts.sh` (or `--fix` to copy server→client).
   A green client typecheck is **not** proof of sync — a widened union (new
   field, new enum member) compiles fine against stale code on both sides.
3. If the field is backed by a DB column: edit `server/src/db/schema/*.ts`,
   then `pnpm db:generate` (never hand-write a migration), then
   `pnpm db:migrate`. Nullable-in-DB and optional-in-Zod are **independent**
   decisions — decide each deliberately.
4. Update the row→DTO adapter. A nullable DB column becoming a required Zod
   field needs an explicit default, never an implicit one — e.g.
   `evidence_path: row.evidencePath ?? ''` in
   `server/src/modules/conventions/helpers.ts`'s `toConventionDto`.
5. Confirm the Fastify route still declares this schema as its `response`
   via `fastify-type-provider-zod`. Never hand-roll `Schema.parse()` in the
   handler (`server/CLAUDE.md`) — a shape mismatch should fail at
   serialization, not pass silently.
6. Update every client consumer: hooks (`client/src/lib/hooks/*.ts`),
   components that destructure the field. Grep for the field name — don't
   rely solely on typecheck to surface every call site, especially for a
   widened union.
7. Extend tests: the hermetic unit test, and the `*.it.test.ts` if the field
   round-trips through Postgres — the DB-backed test is what proves the
   adapter's default/coalescing matches a real persisted row, not just an
   in-memory fixture.
8. Re-run `./scripts/check-contracts.sh`, then `pnpm typecheck` in both
   `server/` and `client/`, before calling the change done.

## Two axes that are easy to conflate

| Axis | Where it's decided | Independent of |
| --- | --- | --- |
| DB column nullable / `NOT NULL` | `server/src/db/schema/*.ts` + migration | The Zod schema's `optional()` |
| Zod field `optional()` / required | `server/src/vendor/shared/contracts/*.ts` | The DB column's nullability |
| What the client can assume | The DTO adapter's default, not the DB or the Zod schema alone | Both of the above |

The DTO adapter is the seam that reconciles all three — a required Zod field
backed by a nullable column is not a bug as long as the adapter supplies a
default for every row that predates the change.

## Breaking-change judgment call

- **optional → required** on a response field is breaking for any row
  written before the change. Decide a backfill migration or a coalesced
  default in the adapter — do not assume every existing row already has a
  value.
- **required → optional** is usually safe server-side but silently breaks
  any client code that destructured the field without a null check.
- **A brand-new required field** on an existing response type is the
  optional→required case in disguise, for the same reason.

## Known pitfalls (this repo's own incidents)

- `row!` (non-null assertion) is banned
  (`@typescript-eslint/no-non-null-assertion`, `eslint.config.js`). When
  `noUncheckedIndexedAccess` types an `INSERT ... RETURNING` result as
  `Row | undefined`, the settled shape is
  `if (!row) throw new Error('insert into <table> returned no row')` — a
  plain `Error` (→ 500), not `NotFoundError`, because a single-row insert
  returning nothing is a broken invariant, not a missing resource.
  (`server/src/modules/repos/repository.ts:55`, `server/INSIGHTS.md`)
- A repository **update** that returns `Row | undefined` signals a real
  read-modify-write race, not type noise — asserting it away turns a 404
  into a 500. Fix: `if (!row) throw new NotFoundError(...)`.
  (`server/src/modules/reviews/findings.ts:25`, `server/INSIGHTS.md`)
  Assume the same gap in any lookup-then-update pair when a field's
  requiredness changes what the update path can return.

## Worked example in this codebase

`specs/03-conventions.md`'s "Contract changes" section is the template for
writing up this kind of change: `ConventionCandidate` gained `category`,
`evidence_start_line`, `evidence_end_line`; new `ConventionScan` and
`PatchConventionBody` types were added. `server/src/modules/conventions/helpers.ts`'s
`toConventionDto` is the adapter pattern — nullable DB columns coalesced to
required response fields, in one place, reused by both the list and
single-item routes.

## Constraints and Warnings

- `**/src/vendor/**` is otherwise "do not touch" (vendored) — a deliberate
  contract change is the one documented exception (root `CLAUDE.md`).
- Never hand-roll response validation in a route handler; the Zod schema
  declared on the route is what enforces the new shape.
- Never treat a green client typecheck as proof the client mirror is in
  sync — run `check-contracts.sh`.

## Related Skills

- `zod` — schema construction and composition itself, once the new shape is
  decided.
- `drizzle-orm-patterns`, `postgresql-table-design` — the DB column side of
  a backed field.
- `pr-self-review` — routes diffs touching
  `server/src/vendor/shared/contracts/**` to this skill (see `routing.md`).

## References

- `specs/03-conventions.md`
- Root `INSIGHTS.md` (2026-08-04, gated 2026-08-14 — contract-drift entry)
- `server/INSIGHTS.md` (`row!` ban; update-race entry)
- `scripts/check-contracts.sh`
- `server/CLAUDE.md`
