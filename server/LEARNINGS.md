# LEARNINGS — server/@devdigest/api

> append-only: add entries, never overwrite existing ones. Review monthly, delete stale notes.

## What Works

**2026-07-31** · **DB/API** · Separate IN-query after the main PR query is the correct pattern for fetching latest `agent_run` cost per PR — a JOIN duplicates rows when a PR has multiple runs · Confidence: high

## Codebase Patterns

**2026-07-31** · **DB** · Фінансові значення зберігаємо як `numeric(12, 8)` в Drizzle — не `real` і не `float`, бо ті мають floating point похибку для грошей (server/src/db/schema/runs.ts) · Confidence: high

## Recurring Errors & Fixes

**2026-08-02** · **DB/Migrations** · NEVER create Drizzle migration SQL files manually — Drizzle tracks applied migrations in `__drizzle_migrations` table by hash, so a hand-written file won't be registered even if the SQL runs. Always use `pnpm db:generate` to create both the SQL and the journal entry, then `pnpm db:migrate` to apply · Confidence: high

## What Doesn't Work

<!-- Dead ends, anti-patterns, wrong turns — most valuable section, most often skipped -->

## Session Notes

**2026-08-02** · Реалізовано findings severity breakdown. Додано 3 колонки в `agent_runs` (findings_critical/warning/suggestion), розширено контракти `RunSummary` + `PrMeta`, оновлено `run-executor.ts` для обчислення після grounding, `pulls/routes.ts` розширено existing cost IN-query. Клієнт: новий `FindingsSeverityBadge` (portal popup), оновлено `RunHistory` (SeverityChips + portal), `FindingsPanel` (фільтр-кнопки). Тести не написані.

**2026-07-31** · Реалізовано Run Cost Badge (L01). Додано поле `cost` в `agent_runs`, розширено contracts `PrMeta` / `RunSummary` / `RunStats`, cost відображається в PR list / Agent runs tab / sidebar. Тести не написані — залишено на наступну сесію.

## Tool & Library Notes

**2026-07-31** · **Drizzle** · `numeric` column type returns `string` from Drizzle, not `number` — always wrap with `Number(val)` before sending to client or TypeScript will silently pass a string through a `number` field (server/src/modules/reviews/repository/run.repo.ts) · Confidence: high

## Open Questions

<!-- Unresolved questions about this module -->
