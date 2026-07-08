# insights.md — client

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save >=10 minutes from reading this?" If not, skip.

## Patterns
- **2026-06-20 [Pattern]** — Severity filter state lives in URL search params (`?severity=critical`), not component state, so filters are bookmarkable and survive reloads. `client/src/app/pulls/[id]/_components/useSeverityFilter.ts:12`

## Mistakes
- **2026-06-18 [Mistake]** — `useBlast(prId)` refetches on every keystroke because the query key includes an unmemoized object; wrap the key in `useMemo`. `client/src/hooks/useBlast.ts:22`

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->

## Open Questions
<!-- Unresolved. -->

---
Last updated: 2026-06-20 · Entries: 2
