# AGENTS.md — `@devdigest/api` (server)

Fastify 5 backend: imports repos/PRs, indexes with `repo-intel`, runs the reviewer
(diff → `reviewer-core` → grounded findings). Drizzle ORM over Postgres (pgvector).
Full architecture, request/DI flow, and API map: **[README.md](README.md)**.

## Commands (run from `server/`, pnpm)

- `pnpm dev` — tsx watch on `:3001` · `pnpm build` — `tsc` · `pnpm typecheck`
- `pnpm db:migrate` · `pnpm db:seed` (idempotent demo data) · `pnpm db:generate`
- `pnpm test` — vitest (unit + integration). Split by filename, see **Testing** below.

## Where things live (`src/`)

- `modules/<name>/` — feature plugins (routes + service). Registered statically in
  `modules/index.ts`. Starter set: repos, pulls, polling, reviews, agents, repo-intel,
  settings, workspace. `_shared/` = cross-module helpers.
- `adapters/` — ports behind the DI container (llm, github, git, astgrep, tokenizer,
  secrets). `adapters/mocks.ts` swaps them in tests.
- `platform/` — `container.ts` (DI), `config.ts` (`loadConfig`). `db/` — Drizzle schema + migrations.
- `vendor/shared` = `@devdigest/shared` (Zod contracts). `prompts/` — server-side prompt bits.

## Non-default conventions

- **Schema-first validation.** Routes declare zod `params`/`body` via
  `fastify-type-provider-zod`; invalid input → `422` before the handler. Don't hand-roll `.parse()`.
- **Plugins register before modules** so encapsulated module plugins inherit helmet/cors/
  rate-limit/SSE and the shared error handler.
- **No keys required to boot** — `loadConfig` marks every secret optional; keys also settable
  via Settings UI. Secrets go through `SecretsProvider`, never `AppConfig`.

## Gotchas

- **Migrations are NOT run on boot** — run `pnpm db:migrate` yourself (pgvector enabled by `0000`).
- The schema is front-loaded with the tables the lesson series needs — later-lesson ones sit
  empty until filled — but a genuinely new feature can still need a new table + its migration.
- Rate limit is global 120/min (off under `NODE_ENV=test`); SSE + `/health*` exempt.
- Grounding is mandatory: findings without a real diff line are dropped; model's score is ignored.

## Testing

Filename split — `*.it.test.ts` = DB-backed (real Postgres via testcontainers, self-skips
without Docker); everything else hermetic (adapters mocked). A DB-backed test **must** use the
`*.it.test.ts` suffix. See [../TESTING.md](../TESTING.md).

## On-demand docs

[README.md](README.md) · [docs/](docs) (design notes) · [specs/](specs) ·
[INSIGHTS.md](INSIGHTS.md) (gotchas & decisions log)

Feature specs worth naming: [specs/smart-diff.md](specs/smart-diff.md) — reviewer-ordered
file groups + per-line findings, and the zero-token guarantee that keeps them free.
