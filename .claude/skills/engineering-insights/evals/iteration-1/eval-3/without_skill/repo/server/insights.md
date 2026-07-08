# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. -->

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2026-07-04 [Decision]** — Blast-radius summary is stored denormalized in `pull_requests.blast_summary`, written once when the review completes, not recomputed per request. The symbol-index walk was 300ms+ on large PRs and the summary is immutable after the run finishes; readers (incl. client `BlastCard.tsx`) render the stored string directly. `server/src/modules/blast/service.ts:88`

## Quirks
- **2026-06-12 [Quirk]** — pgvector `<=>` cosine distance needs an explicit `::vector` cast on bound params or the planner skips the ivfflat index. `server/src/modules/blast/index.ts:55`

## Open Questions
<!-- Unresolved. -->

---
Last updated: 2026-07-04 · Entries: 2
