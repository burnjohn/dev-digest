# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2026-07-04 [Quirk]** — `.onConflictDoUpdate()` silently never fires for `findings` rows where the indexed `file` column is NULL: Postgres treats `NULL != NULL`, so those rows never collide with the unique index and every upsert inserts a duplicate instead of updating. Coalesce `file` to `''` before insert (or replace the plain unique index with a partial/`COALESCE`-based one) so nullable-keyed rows can actually conflict. `server/src/db/schema.ts:140`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-07-04 · Entries: 1
