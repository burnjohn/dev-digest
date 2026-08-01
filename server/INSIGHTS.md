# Insights — server/

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

- `2026-08-01` — The error-handler contract has a hermetic regression guard that needs no Postgres: `routes-smoke` builds the app with `buildApp({ config })` and asserts 422 + `error.code === "validation_error"` via `app.inject`, so changes to the zod branches can be verified in seconds without testcontainers → `cd server && pnpm test routes-smoke` (`test/routes-smoke.test.ts:56`)

## What Doesn't Work

- `2026-08-01` — Debugging an in-flight review under `pnpm dev` does not work: the boot reaper is awaited before the server listens and unconditionally flips EVERY row with `status = running` to `failed`, so a single file save under `tsx watch` reloads the process and silently kills the run being watched. The run just becomes `failed` with no error event and no stack — the only trace is the log line `reaped stale running agent_runs on boot`. Do not edit server files while a run is in flight; for long runs start the API without watch → `server/src/app.ts:81`, unconditional `where(eq(t.agentRuns.status, "running"))` at `server/src/modules/reviews/repository/run.repo.ts:104` → CLAUDE.md

## Codebase Patterns

- `2026-08-01` — Validation failures answer 422 here, never 400, and the error handler has two independent zod branches: `hasZodFastifySchemaValidationErrors` at :118 catches schema-first failures from the type provider (`details` comes from `err.validation`), while the shape-checked branch at :143 catches service-level `.parse()` calls and routes not yet on `schema.body` (`details` comes from `.issues ?? .errors`). Which branch produced the 422 tells you where the parse happened, so fixing one path does not cover the other → `src/app.ts:116`
- `2026-08-01` — Run-event aggregation lives in the client on purpose — do not add a server-side endpoint that returns an aggregated/snapshot view of a run event log. The replay-first RunBus (buffer kept after completion, so late subscribers get full history) plus client-side accumulation already covers it; full reasoning in `client/INSIGHTS.md` under 2026-08-01 → `server/src/platform/sse.ts:43`

## Tool & Library Notes

## Recurring Errors & Fixes

- `2026-08-01` — A 500 with a generic `internal_error` body where a route should have answered 422 `validation_error` on a malformed payload means a ZodError reached the handler and failed every branch: it was raised by a service-level `.parse()` inside `src/vendor/shared/`, so `err instanceof z.ZodError` was false against the server’s own zod copy. The shape check (`name === "ZodError"` plus an `issues` or `errors` array) is the branch that actually catches it → `src/app.ts:138` → CLAUDE.md
- `2026-08-01` — A 500 with a generic `internal_error` body from a newly added route, with `relation "agent_runs" does not exist` (Postgres 42P01) underneath it in the API log, means migrations were never applied to the DB this API is pointed at. Nothing applies them on boot and `./scripts/dev.sh` does not either, so any route touching a table added by an unapplied migration 500s on its first request — the endpoint code is fine → fix with `cd server && pnpm db:migrate`, then retry the request

## Session Notes

## Open Questions

- `2026-08-01` — Is the leading `err instanceof z.ZodError` at `src/app.ts:140` worth keeping now that the shape check subsumes it? It is provably dead for anything raised inside `src/vendor/shared/`, but still the only branch that would catch a subclassed or renamed ZodError from server-local code; dropping it makes the handler depend entirely on the string `"ZodError"` surviving in `err.name`
