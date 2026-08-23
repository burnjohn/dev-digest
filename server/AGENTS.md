# CLAUDE.md — server (`@devdigest/api`)

Fastify API + Drizzle/Postgres (pgvector). Owns the DB schema, GitHub import,
`repo-intel` indexing, and orchestrates `reviewer-core` for actual review
runs. Port 3001. Full picture: [README.md](README.md).

## Docs map

- [README.md](README.md) — setup, module layout, env vars, troubleshooting
- [docs/](docs/) — architecture/design deep-dives for this package
- [specs/](specs/) — route/module contracts owned by this package
- [Insights.md](Insights.md) — gotchas and decisions learned while building this package
- Root docs also apply: [../README.md](../README.md), [../TESTING.md](../TESTING.md), [../docs/agent-prompts/](../docs/agent-prompts/)

## Commands

```bash
pnpm dev            # tsx watch src/server.ts
pnpm typecheck
pnpm test           # vitest (unit; *.it.test.ts are integration, need testcontainers/Docker)
pnpm db:generate     # drizzle-kit generate (after schema changes)
pnpm db:migrate      # apply migrations — NOT run automatically on boot
pnpm db:seed
pnpm build && pnpm start
```

## Conventions & gotchas

- Package manager is **pnpm**, not npm — don't mix lockfiles.
- Imports `@devdigest/reviewer-core` as raw TypeScript source via a tsconfig
  path alias (`reviewer-core/src`), not as a built dependency — if
  `reviewer-core/node_modules` isn't installed, boot fails with
  `ERR_MODULE_NOT_FOUND`. See [Insights.md](Insights.md).
- DB migrations are manual (`pnpm db:migrate`), never automatic on server boot.
- Real secrets (API keys) live at runtime in `~/.devdigest/secrets.json`
  (mode `0600`) — never in `.env`, git, or the DB.
- Request/response schemas come from `@devdigest/shared`
  (`src/vendor/shared`, vendored — not a published package). Add/change
  contracts there, not ad hoc in route handlers.
- Adapters (LLM, GitHub, git, ast-grep) sit behind the DI container
  (`src/platform/container.ts`) with mocks in `src/adapters/mocks.ts` — use
  the mocks in unit tests, never real network/keys.
- Before starting work here, read [Insights.md](Insights.md) and treat it as
  high-confidence guidance. At session end, if something non-obvious was
  learned, append it (read the file first to avoid duplicating an existing
  entry) — see the `engineering-insights` skill.
