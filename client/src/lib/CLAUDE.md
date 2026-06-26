# client/src/lib/CLAUDE.md

Data layer — API client, hooks, and shared utilities. Parent conventions in [../../CLAUDE.md](../../CLAUDE.md).

## API client (`api.ts`)

`apiFetch` is the **only** entry point for API calls — never use raw `fetch` or `axios` in components.

```ts
import { api } from '@/lib/api'

await api.get('/repos')
await api.post('/pulls/:id/review', { agent_ids: [...] })
```

Throws `ApiError` (with `.status` and `.body`) on non-2xx responses. Catch it explicitly when you need to distinguish error types.

## Hooks (`hooks/`)

All server state lives in hooks backed by TanStack Query — never `useEffect` for data fetching.

- Naming: `use<Domain><Action>` — e.g., `useReviewRun`, `useAgentList`, `usePrDetail`
- QueryKey shape: `[domain, id?, ...filters]` — keep consistent for correct cache invalidation
- Mutations call `queryClient.invalidateQueries` on success — don't manually update cache

## SSE (live run progress)

Use `useRunTrace` for subscribing to a review run's event stream. Do not create bare `EventSource` instances elsewhere — `useRunTrace` handles cleanup and reconnect.

## Utilities

| File | Purpose |
|---|---|
| `feature-models.ts` | Resolve which model to use for a feature model slot |
| `github-urls.ts` | Build GitHub PR / file / line URLs |
| `model-label.ts` | Human-readable label for a provider+model pair |
| `repo-context.tsx` | React context for the currently selected repo |
| `providers.tsx` | Root QueryClient + theme providers |

## See also

- [../app/CLAUDE.md](../app/CLAUDE.md) — App Router and RSC conventions
