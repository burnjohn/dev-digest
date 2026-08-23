# CLAUDE.md — DevDigest (root)

DevDigest is a local-first AI pull-request review tool, built as a course
starter template: one working slice today (add a repo → import a PR → run an
agent review → grounded findings), with the DB schema and roadmap already
laid out for features later course lessons add back in. Full picture:
[README.md](README.md).

Four standalone packages, no shared workspace tool — cross-package code is
shared via tsconfig path aliases, not published modules:

| Package | Path | What it is | Docs |
|---|---|---|---|
| `@devdigest/api` | [server/](server/) | Fastify API + Drizzle/Postgres (pgvector) | [server/CLAUDE.md](server/CLAUDE.md) |
| `@devdigest/web` | [client/](client/) | Next.js 15 web app (the studio) | [client/CLAUDE.md](client/CLAUDE.md) |
| `@devdigest/reviewer-core` | [reviewer-core/](reviewer-core/) | Pure review engine: diff → prompt → LLM → grounded findings | [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md) |
| `@devdigest/e2e` | [e2e/](e2e/) | Deterministic browser e2e (agent-browser, no LLM) | [e2e/CLAUDE.md](e2e/CLAUDE.md) |

Before working inside a package, read that package's own `CLAUDE.md` — it
carries the commands and conventions specific to that package.

## Root docs map

- [README.md](README.md) — architecture, setup, full package table, course roadmap (L01–L08)
- [TESTING.md](TESTING.md) — testing/CI strategy, suite map, how to run each suite locally
- [docs/](docs/) — cross-cutting docs; currently [docs/agent-prompts/](docs/agent-prompts/), the canonical copies of the review-agent system prompts
- [specs/](specs/) — cross-package specs/contracts (e.g. things that touch more than one package, like `@devdigest/shared`)
- [Insights.md](Insights.md) — running log of cross-cutting gotchas and decisions (project-wide; package-specific ones live in each package's own `Insights.md`)

## Common commands

```bash
./scripts/dev.sh          # bootstrap + run everything (Postgres in Docker, API :3001, web :3000)
./scripts/dev.sh --no-seed
./scripts/dev.sh --db-only
docker compose down       # stop Postgres (dev.sh only stops the dev servers)
```

## Conventions

- Don't duplicate content across `CLAUDE.md` files and `README.md`/`docs/`. `CLAUDE.md` links out and gives agent-operational essentials (commands, gotchas); prose/architecture belongs in `README.md`/`docs/`.
- Package boundaries are real: `server` and `client` use pnpm, `reviewer-core` and `e2e` use npm deliberately (see [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md)). Don't add a root lockfile or workspace config that blurs this.
- Before working in a package, read that package's `Insights.md` (plus this
  file's, if the change is cross-cutting) and treat it as high-confidence
  guidance. At the end of a substantive session, if something non-obvious
  was learned, append it — read the file first so you don't duplicate an
  existing entry. Format and rules: [.claude/skills/engineering-insights/SKILL.md](.claude/skills/engineering-insights/SKILL.md).
