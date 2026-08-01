# server/ — @devdigest/api

Fastify 5 backend: repos, PRs, agents, reviews, repo-intel indexer.

## Stack

- Fastify 5, TypeScript 5.7 (tsx watch), Drizzle ORM, Postgres + pgvector
- `fastify-type-provider-zod` — Zod schemas drive request validation AND response serialization
- DI via `platform/container.ts` — lazy construction, tests inject mocks via `ContainerOverrides`
- SSE streaming for live review progress (`fastify-sse-v2`, `platform/sse.ts` → `runBus`)

## Commands

```sh
pnpm dev             # API on :3001
pnpm db:migrate      # apply migrations (NOT auto on boot!)
pnpm db:seed         # idempotent demo data
pnpm db:generate     # drizzle-kit generate after schema changes
pnpm test            # all tests (unit + integration)
pnpm typecheck       # tsc --noEmit
```

## Where things live

- `src/modules/<name>/` — feature modules (routes.ts + service.ts + repository.ts)
- `src/modules/index.ts` — static module registry (add new module = 1 import + 1 entry)
- `src/platform/` — config, container, errors, jobs, SSE bus, price-book
- `src/adapters/` — ports & adapters (llm, github, git, astgrep, codeindex, secrets, ...)
- `src/db/schema/` — Drizzle table definitions; `src/db/migrations/` — generated, don't edit
- `src/vendor/shared/` — `@devdigest/shared` Zod contracts (the canonical copy)

## Modules (starter set)

settings · repos · pulls · polling · workspace · agents · reviews · repo-intel

## Conventions

- Every module is a Fastify plugin registered in `modules/index.ts` — static, not filesystem autoload
- Route validation is schema-first (zod in route schema, not manual `.parse()` in handler)
- Adapters behind interfaces — `GitClient`, `LLMProvider`, `CodeIndex`, `Embedder`, etc.
- Secrets go through `SecretsProvider` chokepoint, never read raw from env in modules
- Server reaps orphaned "running" runs on boot — assumes single-instance deployment; the reap is unconditional, so a `tsx watch` reload silently fails any in-flight run (don't edit server files mid-run)

## Gotchas

- `GITHUB_TOKEN` is canonical; `GITHUB_PAT` accepted as fallback (both checked)
- repo-intel facade returns degraded-but-valid results when no index exists — never throws
- Grounding gate is mandatory: findings without valid diff line citations are dropped
- `EMBEDDINGS_ENABLED=false` (default) → zero OpenAI calls; set true only if you need memory/RAG
- Error handler duck-types ZodError (shape check, not just instanceof) due to dual zod instances — an unexpected 500 on a malformed body is this; validation answers 422 here, never 400

## Do not touch

- `src/db/migrations/` — drizzle-kit generated
- `src/vendor/shared/` — shared contracts, coordinate across packages

## Deep docs (read on demand)

- [INSIGHTS.md](INSIGHTS.md) — what past sessions learned in this package; read before non-trivial work
- [README.md](README.md) — request/DI flow diagram, API map, env vars, review context notes
- [src/modules/repo-intel/README.md](src/modules/repo-intel/README.md) — indexer pipeline details
- [../docs/agent-prompts/](../docs/agent-prompts/) — built-in reviewer prompt design
- [../TESTING.md](../TESTING.md) — test split strategy, CI workflows
