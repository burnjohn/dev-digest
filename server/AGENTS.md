# server/ — @devdigest/api

Read `server/README.md` for full architecture, DI flow diagram, and env vars reference.

## Module pattern

Each feature lives in `modules/<name>/`:
- `routes.ts` — Fastify plugin (exported default)
- `service.ts` — business logic
- `repository.ts` — Drizzle queries
- `helpers.ts` / `constants.ts` — pure functions

**Add a module:** create `modules/<name>/routes.ts` + register in `modules/index.ts`. Nothing else to wire.

## Gotchas

- Rate limiting: global 120/min (disabled under `NODE_ENV=test`); SSE + `/health*` exempt
- DI container (`platform/container.ts`) is lazy — adapters initialise on first use
- `RunBus` (`platform/sse.ts`) fans out run events to all SSE subscribers
- Zod contracts from `vendor/shared` drive BOTH route validation AND response serialization — no duplicate types
- Do NOT describe JSON shape in agent system prompts — the JSON Schema enforces it at the LLM level

## Testing split

- `*.it.test.ts` = integration (real Postgres via testcontainers — needs Docker)
- Everything else = hermetic unit (no Docker, no network)
- `pnpm test` runs both; unit-only: `pnpm exec vitest run --exclude '**/*.it.test.ts'`

## Session protocol

- **Start:** silently read `server/LEARNINGS.md` before responding — treat as high-confidence guidance.
- **End:** run `/engineering-insights` only if something substantial and new was found. If nothing non-obvious happened, write nothing. Before writing any entry, re-read LEARNINGS.md to avoid duplicates.

## Read when

- Architecture + DI flow diagram → `server/README.md`
- Env vars full list → `server/README.md#environment`
- Lessons and session learnings → `server/LEARNINGS.md`
- API specs → `server/specs/`
- Technical docs → `server/docs/`
