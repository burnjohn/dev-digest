# Insights — server

Running log of non-obvious findings, decisions, and hard-won gotchas for
`@devdigest/api`. Append newest at the top. Keep entries short: what surprised
you, why it is that way, and what to do about it. This is the file Claude reads
when a task in `server/` needs the *why*, not the *what* — the [AGENTS.md](AGENTS.md)
map stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

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
