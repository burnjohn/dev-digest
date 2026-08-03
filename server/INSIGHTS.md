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
- `2026-08-02` — When a feature spans route → bus → executor → repo, test the WIRING, not the contract: cancellation had one passing engine-contract test (a throwing callback stops the loop) and four defects, every one of them in a layer that test never touched. The contract was the only thing not broken → `reviewer-core/test/run.test.ts:91`

## What Doesn't Work

- `2026-08-01` — Debugging an in-flight review under `pnpm dev` does not work: the boot reaper is awaited before the server listens and unconditionally flips EVERY row with `status = running` to `failed`, so a single file save under `tsx watch` reloads the process and silently kills the run being watched. The run just becomes `failed` with no error event and no stack — the only trace is the log line `reaped stale running agent_runs on boot`. Do not edit server files while a run is in flight; for long runs start the API without watch → `server/src/app.ts:81`, unconditional `where(eq(t.agentRuns.status, "running"))` at `server/src/modules/reviews/repository/run.repo.ts:104` → CLAUDE.md
- `2026-08-01` — Any failing background job takes down the whole API: `JobRunner.enqueue` marks the row `failed` and then rethrows into the `done` promise, and every caller in `modules/repos/service.ts` ignores `done`, so the rejection is unhandled and Node exits. Symptom: the process dies with a stack trace and no request in flight, while the `jobs` row already says `failed` — which is why the rethrow buys nothing on the fire-and-forget path → `src/platform/jobs.ts:96`
- `2026-08-01` — Authenticating a clone by embedding the PAT in the URL (`withGitHubToken`) leaks it: on failure simple-git echoes the whole argv, so the token lands in plaintext in the API log and in any pasted stack trace. A 403 from a repo the PAT lacks access to is enough to trigger it → `src/modules/repos/service.ts:54`
- `2026-08-02` — The reviews integration suite made REAL paid OpenRouter calls: `appWith` stubbed only the `openai` provider while the seeded agents are openrouter/deepseek, so every `all: true` review resolved a live provider. Symptom is a run row with genuine tokens that no mock produced; stubbing all three provider ids cut the file from 55s to 4.8s — the runtime WAS the network → `server/test/reviews.it.test.ts:113`
- `2026-08-02` — Rethrowing from a fire-and-forget p-queue job so 'callers can see the failure' — no caller awaits done, so every job failure became an unobserved rejection and exited the Node process; pre-observe with done.catch(() => undefined) and the rethrow still reaches anyone who does await → server/src/platform/jobs.ts:106, server/test/jobs-crash.test.ts

## Codebase Patterns

- `2026-08-01` — Validation failures answer 422 here, never 400, and the error handler has two independent zod branches: `hasZodFastifySchemaValidationErrors` at :118 catches schema-first failures from the type provider (`details` comes from `err.validation`), while the shape-checked branch at :143 catches service-level `.parse()` calls and routes not yet on `schema.body` (`details` comes from `.issues ?? .errors`). Which branch produced the 422 tells you where the parse happened, so fixing one path does not cover the other → `src/app.ts:116`
- `2026-08-01` — Run-event aggregation lives in the client on purpose — do not add a server-side endpoint that returns an aggregated/snapshot view of a run event log. The replay-first RunBus (buffer kept after completion, so late subscribers get full history) plus client-side accumulation already covers it; full reasoning in `client/INSIGHTS.md` under 2026-08-01 → `server/src/platform/sse.ts:43`
- `2026-08-02` — Cost lives on `agent_runs`, and `reviews.run_id` is the only link from a review back to its usage — the verdict banner reads cost by joining through it client-side rather than adding a field to `ReviewRecord`, because the timeline on the same page has already fetched the run list → `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:57`

## Tool & Library Notes

- `2026-08-03` — git strips URL userinfo from its own error output (transport_anonymize_url) — a tokened clone URL fails with "fatal: unable to access 'https://github.com/...'" with credentials already removed, so a reviewer claim that the PAT leaks via git stderr into jobs.error did not reproduce; the scrub added in platform/jobs.ts redactUrlCredentials() is defense-in-depth for non-git job kinds, not a fix for git → verified empirically 2026-08-03 against a live 403 row and a synthetic bad-token clone (PR #7)

## Recurring Errors & Fixes

- `2026-08-01` — A 500 with a generic `internal_error` body where a route should have answered 422 `validation_error` on a malformed payload means a ZodError reached the handler and failed every branch: it was raised by a service-level `.parse()` inside `src/vendor/shared/`, so `err instanceof z.ZodError` was false against the server’s own zod copy. The shape check (`name === "ZodError"` plus an `issues` or `errors` array) is the branch that actually catches it → `src/app.ts:138` → CLAUDE.md
- `2026-08-01` — A 500 with a generic `internal_error` body from a newly added route, with `relation "agent_runs" does not exist` (Postgres 42P01) underneath it in the API log, means migrations were never applied to the DB this API is pointed at. Nothing applies them on boot and `./scripts/dev.sh` does not either, so any route touching a table added by an unapplied migration 500s on its first request — the endpoint code is fine → fix with `cd server && pnpm db:migrate`, then retry the request
- `2026-08-02` — A job row stuck 'running' with no matching git/child process after a tsx-watch reload is an orphan: the in-memory p-queue died with the old process but the DB row survives, and anything keying off jobs.status (refresh dedupe) pins itself to a job that will never finish → server/src/platform/jobs.ts reapOrphans(), wired in app.ts boot; found only by live verification after all tests were green (PR #7)

## Session Notes

## Open Questions

- `2026-08-01` — Is the leading `err instanceof z.ZodError` at `src/app.ts:140` worth keeping now that the shape check subsumes it? It is provably dead for anything raised inside `src/vendor/shared/`, but still the only branch that would catch a subclassed or renamed ZodError from server-local code; dropping it makes the handler depend entirely on the string `"ZodError"` surviving in `err.name`
