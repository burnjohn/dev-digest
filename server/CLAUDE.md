# server (@devdigest/api) — agent guide

Fastify 5 API. Imports repos/PRs, indexes repos (repo-intel), runs the reviewer (delegating
the core review to `reviewer-core`), persists findings. Drizzle over Postgres/pgvector.

## Where things live
- `src/modules/<name>/routes.ts` — feature plugins, registered **statically** in `src/modules/index.ts` (no autoload).
- `src/adapters/` — ports to the outside world (`llm/`, `github/`, `git/`, `codeindex/`, `embedder/`…); all mockable via `adapters/mocks.ts`.
- `src/platform/` — cross-cutting infra: `config.ts`, `container.ts` (DI), `model-router.ts`, `grounding.ts`, `sse.ts`.
- `src/db/` — Drizzle `schema/*.ts`, `migrations/`, `migrate.ts`, `seed.ts`.
- `src/vendor/shared/` — vendored Zod contracts (mirror of the client copy).

## Conventions
- Zod schemas drive **both** validation and serialization (`fastify-type-provider-zod`).
- The reviewer path: `modules/reviews/run-executor.ts` gathers inputs → calls into `reviewer-core`; the server injects adapters + pricing.
- New DB column: edit `db/schema/*.ts` → `pnpm db:generate` (drizzle-kit) → `pnpm db:migrate`. **Never hand-write migration SQL.**
- Adding a contract field → edit **both** vendored copies (here + `client/src/vendor/shared/`) in lock-step.

## Tests
- Unit (hermetic, mocked): `pnpm exec vitest run --exclude '**/*.it.test.ts'` — no Docker.
- Integration: `*.it.test.ts`, real Postgres via testcontainers — needs Docker, self-skips without it.
- Both: `pnpm test`. Typecheck: `pnpm typecheck`.

## Do-not-touch
`src/vendor/shared/`, `src/db/migrations/`. `package.json` is `skip-worktree`.
