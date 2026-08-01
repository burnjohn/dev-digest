# Insights — client/

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

## What Doesn't Work

## Codebase Patterns

- `2026-08-01` — An effect that opens an `EventSource` must depend on a PRIMITIVE key, never on the array or object of ids: `useRunEvents` keys on `runIds.join(",")` because a fresh array identity every render tears down and reopens every stream, so each render refetches the whole replay buffer and hammers the API (symptom: a flood of `/runs/:id/events` requests and events that keep resetting). The `react-hooks/exhaustive-deps` disable directly above the dep array is load-bearing — putting `runIds` back in the deps reintroduces the loop → `client/src/lib/hooks/reviews.ts:171` (key) and the eslint-disable at :212
- `2026-08-01` — SSE frames are parsed and accumulated in the client (`useRunEvents`), deliberately not behind a server-side aggregation endpoint: the UI needs incremental per-event updates regardless, and the RunBus stream is replay-first — it keeps its buffer after a run completes so a late subscriber replays full history before going live — so a server-side snapshot/aggregate endpoint would add a second code path for data the client already has → `client/src/lib/hooks/reviews.ts:168`, late-subscriber buffer retention at `server/src/platform/sse.ts:43`

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
