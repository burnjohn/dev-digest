# DevDigest — agent guide

Local-first AI pull-request reviewer. Import a PR → assemble a prompt (diff + repo map) →
call an LLM → persist grounded findings. Course starter: base works end to end; each lesson
adds one feature.

## Before answering
Search the touched package's `docs/`, `specs/`, and `INSIGHTS.md` FIRST — they are curated and
may already answer it — then read code. For stack/commands/architecture, read `README.md`.

## Session protocol (engineering-insights loop)
- **Start:** before working in a package, read its `INSIGHTS.md` and summarize the top 3
  relevant points back — this forces an active read and catches a silently-failed load.
- **During:** capture a non-obvious finding the moment you hit it (see the `engineering-insights` skill).
- **End:** run `/engineering-insights`. Record only substantial, file-grounded, non-duplicate
  findings; if nothing substantial came up, write nothing — but don't skip the check.
  Writes are **append-only** (never overwrite an `INSIGHTS.md`).

## Layout (where things live)
NOT a monorepo workspace — each package has its own `package.json` + lockfile; cross-package
code is shared via tsconfig path aliases.

| Package | Dir | Role | Port |
|---|---|---|---|
| `@devdigest/web` | `client/` | Next.js 15 studio UI | 3000 |
| `@devdigest/api` | `server/` | Fastify + Drizzle + Postgres/pgvector | 3001 |
| `@devdigest/reviewer-core` | `reviewer-core/` | pure review engine (diff→prompt→LLM→findings) | — |
| `@devdigest/e2e` | `e2e/` | deterministic browser flows (agent-browser) | — |

Working inside a package? Read its own `CLAUDE.md` first.

## Commands
- **Run everything:** `./scripts/dev.sh` (Docker Postgres → migrate → seed → API + web).
  Flags: `--no-seed`, `--no-client`, `--db-only`. Needs Node ≥22, pnpm ≥10, Docker.
- **DB:** `cd server && pnpm db:generate` (drizzle-kit, after editing `db/schema/*.ts`) →
  `pnpm db:migrate` → `pnpm db:seed`. Never hand-write migration SQL.
- **Test/typecheck:** `client` & `server` → `pnpm test` + `pnpm typecheck`;
  `reviewer-core` → `npm test`; `e2e` → `npm test` (needs the running stack).
  Server unit-only (no Docker): `pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  integration tests are `*.it.test.ts` and self-skip without Docker.

## Conventions (not obvious from code)
- ESM: relative imports carry the `.js` extension.
- Server modules are registered **statically** in `server/src/modules/index.ts` — no filesystem autoload.
- Shared Zod contracts are vendored as **two hand-synced copies** — `server/src/vendor/shared/`
  and `client/src/vendor/shared/`. Adding a field means editing **both** in lock-step.
- Adapters (LLM/git/github) sit behind a DI container (`server/src/platform/container.ts`) and
  are swapped for mocks (`server/src/adapters/mocks.ts`) in tests.
- Findings carry `severity` = `CRITICAL | WARNING | SUGGESTION` (`vendor/shared/contracts/findings.ts`).

## Do-not-touch (without coordination)
- `server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit.
- Lockfiles. `server/package.json` is `skip-worktree` (local variant diverges).

## Keys
LLM/GitHub keys are optional at boot; set `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` /
`GITHUB_TOKEN` in `server/.env` or the Settings UI. Tests need no keys (models mocked).
