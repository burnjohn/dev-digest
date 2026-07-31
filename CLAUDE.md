# DevDigest — root map (for AI agents)

This file is the **map**, not the docs. It says what exists and where; the detail
lives in the linked files. No `@import` — follow links lazily, on demand.

## Stack
- **Multi-package, no workspace.** Each package has its own `package.json` +
  lockfile; cross-package code is shared via tsconfig path aliases, not published
  modules. TypeScript everywhere.
- **Node ≥ 22 · pnpm ≥ 10 · Docker** (Postgres + pgvector). Only Postgres runs in
  Docker; API and web run on the host.

## Modules
| Path             | Package                    | Role                                             | Port |
|------------------|----------------------------|--------------------------------------------------|------|
| `client/`        | `@devdigest/web`           | Next.js 15 studio (UI)                           | 3000 |
| `server/`        | `@devdigest/api`           | Fastify API + Drizzle/Postgres; hosts `repo-intel` | 3001 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine: diff → prompt → LLM → grounded findings | —   |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e (agent-browser)        | —    |

## Commands
- **Everything up:** `./scripts/dev.sh` (Postgres + API :3001 + web :3000, seeded).
- **Per package:** `pnpm dev · build · test · typecheck` (server also
  `db:generate · db:migrate · db:seed`).
- **Migrations are NOT applied on boot** — run `cd server && pnpm db:migrate`.

## Conventions & do-not-touch
- **Shared contracts** = Zod schemas under `server/src/vendor/shared`
  (`@devdigest/shared`), mirrored into `client/src/vendor/shared` and consumed by
  `reviewer-core`. One schema drives validation + serialization. **Do not
  hand-edit** vendored copies — they are vendored, not source.
- **Secrets** (LLM keys, `GITHUB_TOKEN`) live in `~/.devdigest/secrets.json`
  (mode `0600`), never in git or the DB.

## Read when…
- **At the START of any task, first read the touched module's `INSIGHTS.md`**
  (engineering-insights skill); at the END, record any substantial, non-duplicate
  insight there.
- Read `README.md` when you need the system overview, quick start, or the
  course-lesson roadmap.
- Read `docs/README.md` when you need deep architecture / design docs.
- Read `docs/ARCHITECTURE.md` when you need the full end-to-end review flow.
- Read `TESTING.md` when running or adding tests (per-package suites, hermetic vs
  DB-backed split).
- Read `docs/agent-prompts/` when working on reviewer system prompts or model choice.
- Read `<module>/CLAUDE.md` **before editing any file inside that module** — it
  maps the module and links its README / docs / specs / INSIGHTS.
