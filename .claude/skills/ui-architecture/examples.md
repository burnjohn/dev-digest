# Examples

## 1. New feature, first component

**Bad** — everything flat in the shared folder from day one:
```
src/components/
├── RunTimeline.tsx
├── run-timeline-constants.ts
├── run-timeline-helpers.ts
├── useRunTimeline.ts
```
Flat naming is doing the job a folder should do, and every file is one PR away from being orphaned if the feature grows.

**Good** — one folder, colocated support files, single boundary:
```
src/components/run-timeline/
├── index.ts            # export { RunTimeline } from './RunTimeline';
├── RunTimeline.tsx
├── constants.ts
├── helpers.ts
└── useRunTimeline.ts
```

## 2. Premature promotion to shared `utils/`

**Bad** — a formatter used by exactly one feature, promoted to global `lib/` on creation:
```ts
// src/lib/format-run-duration.ts
export function formatRunDuration(ms: number) { ... }
```
```ts
// src/components/run-timeline/RunTimeline.tsx
import { formatRunDuration } from '@/lib/format-run-duration';
```
Only `run-timeline` calls it. Nothing is gained by making it global, and every future reader has to check who else depends on it before changing it.

**Good** — colocated until a second feature needs it:
```ts
// src/components/run-timeline/helpers.ts
export function formatRunDuration(ms: number) { ... }
```
Promote it to `src/lib/` in the same PR that introduces the second caller — not before.

## 3. Business logic in a component body

**Bad**:
```tsx
function RunTimeline({ runId }: { runId: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    fetch(`/api/runs/${runId}/events`)
      .then((r) => r.json())
      .then((data) => setEvents(data.sort((a, b) => a.ts - b.ts)));
  }, [runId]);
  return <ol>{events.map((e) => <li key={e.id}>{e.label}</li>)}</ol>;
}
```
Fetching, sorting, and state all live in the component — untestable without rendering, unreusable if a second view needs the same data.

**Good**:
```tsx
// src/components/run-timeline/useRunTimeline.ts
function useRunTimeline(runId: string) {
  return useApiQuery(['run-events', runId], () => fetchRunEvents(runId), {
    select: (events) => [...events].sort((a, b) => a.ts - b.ts),
  });
}

// src/components/run-timeline/RunTimeline.tsx
function RunTimeline({ runId }: { runId: string }) {
  const { data: events = [] } = useRunTimeline(runId);
  return <ol>{events.map((e) => <li key={e.id}>{e.label}</li>)}</ol>;
}
```

## 4. Barrel files: boundary vs. re-export hub

The rule is about shape, not nesting depth — see [component-organization.md](component-organization.md) for the full table.

**Good** — a single-line component barrel, fine at any nesting level, real repo example (`client/src/components/diff-viewer/CodeLine/index.ts`):
```ts
export { CodeLine } from './CodeLine';
```
And the feature-root boundary one level up (`client/src/components/diff-viewer/index.ts`):
```ts
export { DiffViewer } from './DiffViewer';
export type { DiffCommentApi } from './comments';
```
Both are OK: the first is an import-path convention for one component, the second is the folder's actual public API. Everything else in `diff-viewer/` (`FileCard/`, `helpers.ts`, `constants.ts`) is internal; outside code only ever imports from the root `index.ts`.

**Bad** — `export *` hubs. `client/src/lib/hooks/index.ts` used to look like this, until it was fixed on 2026-08-03:
```ts
export * from './reviews';
export * from './agents';
export * from './core';
export * from './repo-intel';
export * from './trace';
```
Any name collision between `reviews.ts` and `agents.ts` resolves silently by file order — the bug shows up as "wrong hook got imported," not a type error. It now lists each hook by name instead (`export { useSettings, useUpdateSettings, ... } from './core';` etc.). A root `components/index.ts` doing `export * from './diff-viewer'; export * from './app-shell'; ...` has the same problem plus it pulls the whole component graph into the bundler's analysis for a single unrelated import, defeating tree-shaking and slowing HMR — no such file exists in this repo, and this shape is why not. See [tkdodo.eu — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files).

## 5. Constants mixed with logic

**Bad**:
```ts
// src/components/run-timeline/helpers.ts
export const MAX_VISIBLE_EVENTS = 50;
export const STATUS_LABELS = { queued: 'Queued', running: 'Running' };
export function formatRunDuration(ms: number) { ... }
export function groupEventsByStatus(events: Event[]) { ... }
```

**Good** — split by purpose:
```ts
// constants.ts
export const MAX_VISIBLE_EVENTS = 50;
export const STATUS_LABELS = { queued: 'Queued', running: 'Running' };

// helpers.ts
export function formatRunDuration(ms: number) { ... }
export function groupEventsByStatus(events: Event[]) { ... }
```
