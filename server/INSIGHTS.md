# Insights — server

Running log of non-obvious findings, decisions, and hard-won gotchas for
`@devdigest/api`. Append newest at the top. Keep entries short: what surprised
you, why it is that way, and what to do about it. This is the file Claude reads
when a task in `server/` needs the *why*, not the *what* — the [AGENTS.md](AGENTS.md)
map stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-16 — SUPERSEDES 2026-08-15: `pnpm typecheck` is GREEN on `main` again
The two `DATABASE_URL` errors below were fixed in `9421f37` — both entrypoints now sit behind
an `if (!url) { … process.exit(1) }` guard that narrows `string | undefined` to `string`.
`pnpm typecheck` exits 0; treat **any** error as yours, not pre-existing.

### 2026-08-16 — `run_traces` is ONE jsonb document, not columns
The table is `(run_id, trace jsonb)` — there is no `prompt_assembly` or `log` column. Read it as
`(row.trace as RunTrace).prompt_assembly.skills`, with **snake_case** keys inside (it is the wire
contract verbatim). Selecting `t.runTraces.promptAssembly` silently yields `undefined`.

### 2026-08-16 — Widening a contract enum takes 3 edits, not 1 — but never a migration
A value added to a Zod enum in `vendor/shared/contracts/` (e.g. `SkillSource`) also has to
be added to the matching Drizzle `text(col, { enum: [...] })` in `db/schema/`, or
`$inferInsert` rejects it at the repository — the DDL itself needs nothing, since
`0000_init.sql` declares these as plain `text` with **zero** `CHECK` constraints
(`grep -c CHECK` → 0). Third edit is `./scripts/sync-vendor.sh` to re-copy the client vendor tree.

### 2026-08-15 — `Container` structurally satisfies a per-service `Deps` interface
Replacing `constructor(private container: Container)` with an explicit
`interface XServiceDeps { db; jobs; git; secrets }` needs **no** call-site or container change —
`Container` exposes those as public members/getters, so `new RepoService(app.container)` still
compiles. Verified end-to-end on `modules/repos/service.ts` with `pnpm typecheck`.

### 2026-08-15 — `pnpm typecheck` is already red on `main` (2 pre-existing errors)
`db/migrate.ts` and `db/seed.ts` both do `const url = process.env.DATABASE_URL` and pass it
straight to a `string` parameter → `TS2345: 'string | undefined' is not assignable`. Don't chase
these when validating your own change; check whether the errors are only in those two files.

### 2026-08-10 — `reviews.run_id` is a `uuid` — don't seed string run-ids in `.it` tests
`reviews.runId` (`db/schema/reviews.ts`) is a `uuid` column, so seeding `runId: 'run-1'` fails
with `invalid input syntax for type uuid`. To model "findings across N runs" in a `.it` test,
insert N separate `reviews` rows (runId is nullable — omit it), not distinct run-id strings.

### 2026-08-09 — `completeAgentRun` has a THIRD, hidden param-type copy
Adding a field to an agent run means editing the values type in **both**
`repository/run.repo.ts::completeAgentRun` *and* the class wrapper
`reviews/repository.ts::completeAgentRun` (it re-declares the same inline object
type, not `typeof`/`Parameters<>`). Miss the wrapper and you get a TS2353
"unknown property" at the call site in `run-executor.ts`, not at the repo.

### 2026-08-09 — seed
- **Migrations don't run on boot.** A fresh clone that "won't serve" almost always
  just needs `pnpm db:migrate` (pgvector is enabled by migration `0000`).
- **DB-backed tests need the `*.it.test.ts` suffix** or the unit/integration split
  breaks and they run in the wrong (Docker-less) lane.
- **Secrets are not in `AppConfig`** — chase them through `SecretsProvider`
  (`~/.devdigest/secrets.json`), not env parsing.
