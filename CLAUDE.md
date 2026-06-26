# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack
Node ≥22 · pnpm ≥10 · TypeScript 5.7 · Fastify 5 · Next.js 15 · React 19 · Drizzle ORM · Postgres 16 + pgvector · Zod

## Packages

| Folder | Package | Port |
|---|---|---|
| `server/` | `@devdigest/api` | 3001 |
| `client/` | `@devdigest/web` | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | — |
| `e2e/` | `@devdigest/e2e` | — |
| `server/src/vendor/shared/` | `@devdigest/shared` | — |

No monorepo workspace. Cross-package code shared via **tsconfig path aliases** — not published npm modules.

## Commands

```sh
./scripts/dev.sh                                          # Postgres + API + web in one shot
cd server && pnpm db:migrate                              # MUST run after clone — server does NOT auto-migrate
cd server && pnpm db:seed                                 # idempotent demo data
cd server && pnpm dev                                     # API only (:3001)
cd client && pnpm dev                                     # web only (:3000)
```

## Active features (L01)

Cost badge on review runs · severity filter on findings.
Tables for L02–L08 exist in the schema but their modules are **not registered** — they are inert.

## Critical conventions

- **Secrets** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) → `SecretsProvider` only.
  Never read from `process.env` directly in services.
- **Shared types** → `server/src/vendor/shared/` only. Never define the same type in two packages.
- **DB schema is stable** — add tables via new numbered migrations only; never alter existing columns.
- **`reviewer-core` is side-effect-free** — no DB, no file I/O, no env reads. Everything injected.
- **Grounding is mandatory** — never bypass `groundFindings()`. Score is recomputed from surviving findings only; the LLM's score is discarded.

## Do not touch

- `server/src/vendor/shared/` — a change here breaks all packages simultaneously
- `server/drizzle/` migrations — never edit an applied migration file
- `reviewer-core/src/grounding.ts` — citation gate must remain mechanical and predictable

## See also

- [README.md](README.md) — architecture diagram, lesson roadmap, quick-start
- [TESTING.md](TESTING.md) — CI workflows, test split strategy
- [server/CLAUDE.md](server/CLAUDE.md)
- [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md)
- [client/CLAUDE.md](client/CLAUDE.md)
- [e2e/CLAUDE.md](e2e/CLAUDE.md)
