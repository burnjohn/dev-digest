# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Node ≥22 · pnpm ≥10 · TypeScript 5.7 · Fastify 5 · Next.js 15 · React 19 · Drizzle ORM · Postgres 16 + pgvector · Zod

## Packages

| Folder | Package | Port |
| --- | --- | --- |
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

**UI:**

- Cost badge on review runs (tokens · $cost)
- Timeline severity badges: icon-only (AlertOctagon/AlertTriangle/Lightbulb) + count, no borders, click-to-preview popup
- FINDINGS column on PR list: all 3 severity types always shown (0-count at 45% opacity, full severity color); click opens per-finding popup (portal-rendered)
- Run Review button: own grid column between COST and UPDATED, `kind="secondary"` (dark style), always visible
- Severity filter pills in FindingsPanel with icons; active-severity resets on run change via `runId` prop
- Overview tab: VerdictBanner (PR Brief) + Intent + Blast Radius cards; placeholder cards shown when `pr_brief` is null but review exists

**API:**

- `GET /repos/:id/pulls` — `findings_breakdown: { critical, warning, suggestion }` from latest review per PR; `cost_usd` via `SUM(agent_runs.cost_usd)`
- `GET /pulls/:id/runs` — `findings_breakdown` per run from `RunSummary`
- `GET /pulls/:id/brief` — stored `PrBrief` JSONB (workspace-scoped); returns `null` for live PRs (seed-only data)
- `GET /reviews/:id` — single review + findings (workspace-scoped via PR join)
- `POST /findings/:id/action` — unified accept/dismiss (`{ action: "accept"|"dismiss" }`)
- `POST /repos/:id/review-all` — fan-out over open PRs; concurrency cap 3; rate-limit 2/min; detached child logger for background tasks

**`pr_brief` is populated by `pnpm db:seed` only.** Live reviews never write to it. Intent/Blast Radius cards show seed data only; live PR generation is L02+.
Tables for L02–L08 exist in the schema but their modules are **not registered** — they are inert.

## Critical conventions

- **Secrets** (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) → `SecretsProvider` only.
  Never read from `process.env` directly in services.
- **No credentials or instance IDs in `.claude/settings.json`** — allowed-command entries must never embed connection strings, passwords, tokens, or hardcoded UUIDs (workspace/repo IDs). Dev DB credentials are canonical in `docker-compose.yml` only. For psql access use `docker exec devdigest-postgres psql -U devdigest` (reads creds from the running container). One-off shell commands with embedded secrets or session-specific IDs must be removed after use.
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
