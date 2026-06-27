# server/CLAUDE.md

Fastify 5 API — `@devdigest/api` on :3001. Root conventions in [../CLAUDE.md](../CLAUDE.md).

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

- Each feature = Fastify plugin in `src/modules/<name>/` — see [src/modules/CLAUDE.md](src/modules/CLAUDE.md)
- Modules registered statically in `src/modules/index.ts` — no auto-discovery
- Get adapters from `app.container` — **never** import concrete adapter classes in services
- Route schemas use Zod via `fastify-type-provider-zod` — one schema drives both validation and TS types
- Expected failures → throw `AppError`; never throw raw strings or plain `Error`

## Testing

- `*.it.test.ts` = integration (testcontainers Postgres, real DB, no mocks) — needs Docker running
- all other `*.test.ts` = hermetic (uses `src/adapters/mocks.ts` — MockLLMProvider, MockGitClient, etc.)
- Never mock the database in integration tests

## Active features (L01)

`findings_breakdown` aggregation on `GET /repos/:id/pulls` (per-PR severity counts from each PR's latest review) and `GET /pulls/:id/runs` (per-run severity counts). `GET /pulls/:id/brief` returns the stored `PrBrief` JSONB (intent + blast radius + risks + prior-PR history) from `pr_brief`. `GET /reviews/:id` returns a single review with its `findings: FindingRecord[]` (workspace-scoped via PR). `POST /findings/:id/action` accepts `{ action: "accept" | "dismiss" }` and persists timestamp — unified counterpart to the per-verb `/accept` + `/dismiss` routes. All in `src/modules/reviews/`.

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — API route map, module diagram
- [src/modules/CLAUDE.md](src/modules/CLAUDE.md) — module scaffold rules
- [src/db/CLAUDE.md](src/db/CLAUDE.md) — migration rules, schema conventions
- [src/vendor/shared/CLAUDE.md](src/vendor/shared/CLAUDE.md) — cross-package contracts
- [docs/](docs/) — design decisions
- [specs/](specs/) — service behavior specs
- [insights.md](insights.md) — accumulated gotchas
