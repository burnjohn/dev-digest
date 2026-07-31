# server — the engine (`@devdigest/api`, Fastify 5, :3001)
↑ [Root map](../CLAUDE.md)

Map of this module for AI agents. Request/DI flow, API map, and the review-context
notes live in the README (linked below) — this file is the map, not the docs.

## Stack & commands
- Fastify 5 (helmet, cors, rate-limit, `fastify-sse-v2`), Drizzle ORM, `postgres`,
  pgvector. Zod contracts from `src/vendor/shared` double as route schemas via
  `fastify-type-provider-zod` (one def → validation + serialization).
- `pnpm dev` (:3001) · `pnpm build` · `pnpm typecheck` · `pnpm test`.
- DB: `pnpm db:generate · db:migrate · db:seed`. **Migrations are NOT run on
  boot** — run `pnpm db:migrate` (pgvector enabled by migration `0000`).

## Map (where things live)
| Path | Purpose |
|------|---------|
| `src/modules/<name>/` | feature plugins (routes + service); registered in `src/modules/index.ts` |
| `src/modules/repo-intel/` | codebase indexer → repo map (the **Indexed** badge) |
| `src/adapters/*` | ports: llm · github · git · astgrep · tokenizer · secrets (+ `mocks.ts`) |
| `src/platform/` | DI container, `config.ts` (`loadConfig`), error handler |
| `src/db/` | Drizzle schema + migrations |
| `src/prompts/` | prompt templates |
| `src/vendor/shared` | `@devdigest/shared` Zod contracts |

## Conventions (non-default)
- **Test split by filename:** `*.it.test.ts` = DB-backed (real Postgres via
  testcontainers, `test/helpers/pg.ts`); everything else = hermetic. A test that
  imports `test/helpers/pg.ts` **must** use the `.it.test.ts` suffix.
- **Schema-first validation:** routes declare zod `params`/`body`; invalid input is
  `422` before the handler. Don't hand-roll `Schema.parse(req.body)`.
- Adapters sit behind the DI container (`platform/container.ts`) so tests swap in
  `src/adapters/mocks.ts`.

## Do-not-touch
- Generated Drizzle migrations in `src/db` — regenerate via `pnpm db:generate`,
  don't hand-edit.
- `src/vendor/shared` — vendored contracts, edit at source.
- Secrets never go in git/DB — they live in `~/.devdigest/secrets.json` (mode `0600`).

## Read when…
- Read `./README.md` for the request/DI flow, API map, env vars, and the
  **review context** notes (Repo Intel, injection guard, grounding).
- Read `./docs/README.md` when you need deeper backend architecture / design.
- Read `./specs/README.md` when changing behavior covered by a spec.
- Read `./INSIGHTS.md` at the START of any task here; append substantial,
  non-duplicate insights at the END (engineering-insights skill).
- Read [`../TESTING.md`](../TESTING.md) for the full test strategy.
