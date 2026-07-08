# server/AGENTS.md

Fastify 5 API — `@devdigest/api` on :3001. Root conventions in [../AGENTS.md](../AGENTS.md).

## Commands

```sh
pnpm dev                                                  # start API
pnpm typecheck                                            # tsc --noEmit
pnpm db:migrate                                           # apply migrations
pnpm db:generate                                          # generate migration from schema changes
pnpm db:seed                                              # seed demo data (idempotent)
pnpm exec vitest run --exclude '**/*.it.test.ts'          # unit tests only (hermetic, no Docker)
pnpm exec vitest run .it.test                             # integration tests only (needs Docker)
```

## Architecture rules

- Each feature = Fastify plugin in `src/modules/<name>/` — see [src/modules/AGENTS.md](src/modules/AGENTS.md)
- Modules registered statically in `src/modules/index.ts` — no auto-discovery
- Get adapters from `app.container` — **never** import concrete adapter classes in services
- Route schemas use Zod via `fastify-type-provider-zod` — one schema drives both validation and TS types
- Expected failures → throw `AppError`; never throw raw strings or plain `Error`

## Read When

| Task | Read |
|---|---|
| Adding or changing an API endpoint | [server/docs/api-contracts.md](docs/api-contracts.md) |
| Hit unexpected behavior in this package | [server/insights.md](insights.md) |

## Testing

- `*.it.test.ts` = integration (testcontainers Postgres, real DB, no mocks) — needs Docker running
- all other `*.test.ts` = hermetic (uses `src/adapters/mocks.ts` — MockLLMProvider, MockGitClient, etc.)
- Never mock the database in integration tests

## Active features (L01)

All in `src/modules/reviews/` and `src/modules/pulls/`:

- `GET /repos/:id/pulls` — `findings_breakdown: { critical, warning, suggestion }` from each PR's latest review; `cost_usd` via `SUM(agent_runs.cost_usd)` grouped by PR
- `GET /pulls/:id/runs` — `findings_breakdown` per run (from `RunSummary`)
- `GET /pulls/:id/brief` — stored `PrBrief` JSONB workspace-scoped via `inner join pull_requests`; returns `null` for PRs not in `pr_brief` (composed live by the run-executor after each successful review run since L04 — see `src/modules/reviews/brief-composer.ts`; zero LLM calls)
- `GET /reviews/:id` — single review + `findings: FindingRecord[]`, workspace-scoped via PR join
- `POST /findings/:id/action` — unified `{ action: "accept"|"dismiss" }` endpoint; per-verb `/accept` + `/dismiss` routes remain for backward compat
- `POST /repos/:id/review-all` — fire-and-forget fan-out; concurrency cap 3 (`scheduleNext` pattern); rate-limit 2/min; uses `req.log.child({...})` before the response is sent so background tasks have a valid logger after Fastify recycles the request

## Active features (L04)

In `src/modules/blast/`:

- `GET /pulls/:id/blast` — `BlastResponse`: changed symbols, per-symbol downstream callers (≤20 each, `truncated` map for hidden counts), endpoint/cron attribution, `BlastIndexInfo`, prior PRs, `BlastLink` for GitHub blob URLs; zero LLM calls; workspace-scoped (404 on cross-workspace PR); see [src/modules/blast/README.md](src/modules/blast/README.md)

**Security invariants enforced in this module:**

- Every `findingsForReview` call passes `workspaceId` and joins through `reviews.workspaceId`
- `runCompleted = true` is set only after BOTH `completeAgentRun` AND `saveRunTrace` succeed — prevents a failed trace write from leaving the run `status='done'` with no trace

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — API route map, module diagram
- [src/modules/AGENTS.md](src/modules/AGENTS.md) — module scaffold rules
- [src/db/AGENTS.md](src/db/AGENTS.md) — migration rules, schema conventions
- [src/vendor/shared/AGENTS.md](src/vendor/shared/AGENTS.md) — cross-package contracts
- [docs/](docs/) — design decisions, incl. [docs/api-contracts.md](docs/api-contracts.md)
- [specs/](specs/) — service behavior specs
- [insights.md](insights.md) — accumulated gotchas
