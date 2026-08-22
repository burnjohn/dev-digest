# DevDigest — agent guide

Local-first AI PR reviewer. Course starter: Part-0 works end to end; each lesson adds one feature.

## Before answering
Always search the relevant package's `docs/`, `specs/`, and `INSIGHTS.md` for what the
user asks about FIRST — these are curated and may already answer it — then read code.

## Session protocol (engineering-insights loop)
- **Start:** before touching a package, read its `INSIGHTS.md` and summarize the top 3
  relevant points back — this forces an active read and catches a silently-failed load.
- **Before recording an insight:** re-read that package's `INSIGHTS.md` and do not duplicate
  what's already there.
- **End of session:** run `/engineering-insights`. Record only substantial, file-grounded,
  non-duplicate findings; if nothing substantial came up, write nothing — but don't skip the
  check. Writes are strictly append-only (never overwrite an `INSIGHTS.md`).

## Conventions (not obvious from code)
- NOT a monorepo workspace — each package has its own package.json/lockfile; cross-package code is shared via tsconfig path aliases.
- Modules are registered statically in `server/src/modules/index.ts` (no filesystem autoload).
- ESM: relative imports carry the `.js` extension.

## Do-not-touch
- `server/src/vendor/shared/` and `server/src/db/migrations/` — never hand-edit without coordination.

## Use when
- Stack, commands, architecture, how to run → read `README.md`
- Working inside a package → read that package's AGENTS.md: `server/AGENTS.md`, `client/AGENTS.md`, `reviewer-core/AGENTS.md`, `e2e/AGENTS.md`
- Agent prompt templates → read `docs/agent-prompts/`
