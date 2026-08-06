# Insights — client/

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

- `2026-08-03` — Pixel-matching against ~/Downloads/DevDigest Design (standalone).html: the file is a bundler blob (markup is compressed, grep finds nothing) — open it in the browser, locate the element by its text, and read getComputedStyle()/inline style off the live DOM; hover states are React state, so dispatching a synthetic mouseenter on the design page flips the element into its hover style for capture → extracted chip (11.5px/600, 1px dotted) and agent-name hover (--accent-text + underline) this way (PR #8)

## What Doesn't Work

## Codebase Patterns

- `2026-08-01` — An effect that opens an `EventSource` must depend on a PRIMITIVE key, never on the array or object of ids: `useRunEvents` keys on `runIds.join(",")` because a fresh array identity every render tears down and reopens every stream, so each render refetches the whole replay buffer and hammers the API (symptom: a flood of `/runs/:id/events` requests and events that keep resetting). The `react-hooks/exhaustive-deps` disable directly above the dep array is load-bearing — putting `runIds` back in the deps reintroduces the loop → `client/src/lib/hooks/reviews.ts:171` (key) and the eslint-disable at :212
- `2026-08-01` — SSE frames are parsed and accumulated in the client (`useRunEvents`), deliberately not behind a server-side aggregation endpoint: the UI needs incremental per-event updates regardless, and the RunBus stream is replay-first — it keeps its buffer after a run completes so a late subscriber replays full history before going live — so a server-side snapshot/aggregate endpoint would add a second code path for data the client already has → `client/src/lib/hooks/reviews.ts:168`, late-subscriber buffer retention at `server/src/platform/sse.ts:43`
- `2026-08-03` — vendor/ui has no Tooltip/Popover primitive (and is read-only) — a hover popover is built locally with React state, and the panel must be a DOM CHILD of the position:relative anchor: mouseleave then doesn't fire while the pointer travels into the panel, so no close-delay timers; make the visual gap with paddingTop on the panel, not a top offset, or the dead strip closes it mid-way → RunSeverityBadges/RunSeverityBadges.tsx, RunFindingsPopover.tsx (PR #8)
- `2026-08-05` — src/vendor/shared here is a real hand-maintained copy of the server's canonical contracts, NOT a symlink as this package's CLAUDE.md states — adding or changing a shared contract means editing the server copy too, and the two have already drifted → see the root INSIGHTS.md entry dated 2026-08-05 for the exact drifted files and the `diff -rq` that shows them

## Tool & Library Notes

- `2026-08-06` — vi.fn(async () => new Response(...)) infers a zero-arg mock; capturing fetchMock.mock.calls[0] then fails typecheck with TS2493 ("Tuple type [] has no element at index 0") even though the test runs fine — give the mock factory explicit params, e.g. vi.fn(async (_url: string, _init?: RequestInit) => …), to type mock.calls correctly → client/src/lib/hooks/github-tokens.test.ts (PR feat/per-repo-github-tokens Task 9)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
