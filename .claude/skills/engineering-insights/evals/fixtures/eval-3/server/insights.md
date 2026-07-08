# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. -->

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
- **2026-06-12 [Quirk]** — pgvector `<=>` cosine distance needs an explicit `::vector` cast on bound params or the planner skips the ivfflat index. `server/src/modules/blast/index.ts:55`

## Open Questions
<!-- Unresolved. -->

---
Last updated: 2026-06-12 · Entries: 1
