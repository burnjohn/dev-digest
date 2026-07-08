# insights.md — server

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save >=10 minutes from reading this?" If not, skip.

## Patterns
- **2026-06-10 [Pattern]** — All route handlers must register through `buildServer()` in `server/src/app.ts` so the auth + error-normalizer hooks attach; bypassing it drops auth. `server/src/app.ts:40`

## Mistakes
- **2026-06-15 [Mistake]** — `db:seed` is not idempotent for `review_runs`; running it twice creates duplicate run records that break the agent detail page. Check the `review_runs` count before re-seeding. `server/src/db/seed.ts:44`

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->

## Open Questions
<!-- Unresolved. -->

---
Last updated: 2026-06-15 · Entries: 2
