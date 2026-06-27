# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->
- **2026-06-26 [Pattern]** — `estimateCost(model, tokensIn, tokensOut)` computes USD cost from existing `agent_runs` columns, avoiding a new column and keeping pricing current when the pricing table changes. Before adding a column for a derived numeric value, check whether it can be computed at read time. `server/src/modules/reviews/repository/run.repo.ts:68`

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2025-06-01 [Mistake]** — The server starts without error even when migrations haven't been applied; the first DB query fails with `relation "x" does not exist`, not on startup. Always run `cd server && pnpm db:migrate` before `pnpm dev` on a fresh DB.

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2025-06-01 [Decision]** — `process.env.OPENAI_API_KEY` is `undefined` even when set in `.env`; secrets flow through `SecretsProvider`, which reads `~/.devdigest/secrets.json` first. In services, get secrets via `container.secrets.get('openai')` — never read `process.env` for API keys directly.
- **2025-06-01 [Decision]** — The entire run log (PromptAssembly + RunLogLine[] + stats + grounding summary) is stored as a single `run_traces.trace` JSONB column — there are no per-event rows. To inspect a run: `SELECT trace FROM run_traces WHERE run_id = '...'`. `server/src/db/schema.ts`
- **2025-06-01 [Decision]** — `runBus` is an in-memory event emitter; a client on one API instance won't receive events from a review running on another. Horizontal scaling would require replacing `runBus` with Redis Pub/Sub or an external bus — a known architectural limitation.

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2025-06-01 [Quirk]** — `*.it.test.ts` files pull a Postgres Docker image and create an ephemeral DB per suite; Docker must be running and the first run is slow due to image pull. Use `pnpm exec vitest run --exclude '**/*.it.test.ts'` for fast hermetic-only runs without Docker.
- **2025-06-01 [Quirk]** — All lesson tables (L02–L08) are created by the initial migrations and appear empty until the lesson's module is registered in `src/modules/index.ts`. Empty tables for unimplemented lessons are expected. `server/src/modules/index.ts`
- **2026-06-26 [Quirk]** — Old JSONB documents omit keys that didn't exist when written; `.nullable()` expects the key present with `null`, so parsing an old document that lacks the key fails. For any field added to a JSONB-deserialized schema, use `.nullish()` (= optional + nullable). `server/src/vendor/shared/contracts/trace.ts:68`
- **2026-06-26 [Quirk]** — Native platform packages installed inside WSL (Linux ABI) fail in a Windows Node.js process with `Cannot find module '@rollup/rollup-win32-x64-msvc'`. If `node_modules` were installed in WSL, run `pnpm install` from a Windows shell before running tests or migrations.

---
Last updated: 2026-06-27 · Entries: 9
