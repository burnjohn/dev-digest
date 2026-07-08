# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2026-07-04 [Mistake]** — Drizzle's `.onConflictDoUpdate()` on the `findings` table silently inserts duplicates when the unique-indexed `file` column is NULL, because Postgres treats `NULL != NULL` so NULL rows never conflict. Coalesce nullable indexed columns to `''` before insert (or use a partial unique index) so the upsert actually dedupes. `server/src/db/schema.ts`

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-07-04 · Entries: 1
