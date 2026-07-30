# dev-digest — CLAUDE.md

AI PR review studio. Four independent packages — each with its own lockfile. **No monorepo workspace.**

## Packages

| Folder | Package | Role | Port |
|---|---|---|---|
| `server/` | `@devdigest/api` | Fastify 5 + Drizzle ORM + Postgres (pgvector) | 3001 |
| `client/` | `@devdigest/web` | Next.js 15 studio UI | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | diff → prompt → LLM → grounded findings | — |
| `e2e/` | `@devdigest/e2e` | Deterministic browser flows (agent-browser) | — |

`@devdigest/shared` (Zod contracts) → path-aliased from `server/src/vendor/shared/`. NOT a separate folder.

## Quick start

```sh
./scripts/dev.sh   # Postgres + migrate + seed + server:3001 + client:3000
```

Keys in `server/.env`: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GITHUB_TOKEN`.

## Gotchas (non-obvious)

- **Manual migrations** — server does NOT migrate on boot → `cd server && pnpm db:migrate`
- **Score recomputed server-side** — model's self-reported score is ignored; `scoreFromFindings()` always wins
- **Grounding gate** — findings without a real diff line reference are dropped (hallucination guard)
- **Secrets not in DB/git** — keys live in `~/.devdigest/secrets.json` (0600); env vars are fallback only

## Tests

```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'  # unit — no Docker
cd server && pnpm exec vitest run .it.test                     # integration — needs Docker
cd client && pnpm test
cd reviewer-core && npm test
./scripts/e2e.sh                                               # browser e2e (hermetic)
```

## Troubleshooting

- `relation does not exist` → `cd server && pnpm db:migrate`
- Reset DB → `docker compose down -v` then `./scripts/dev.sh`
- reviewer-core ERR_MODULE_NOT_FOUND → `cd reviewer-core && npm ci`

## Read when working in a package

- `server/CLAUDE.md` — module pattern, DI container, SSE, testing split
- `client/CLAUDE.md` — App Router layout, TanStack Query hooks, component conventions
- `reviewer-core/CLAUDE.md` — pipeline, grounding gate, scoring logic
- `e2e/CLAUDE.md` — hermetic runner, flow conventions, locators
