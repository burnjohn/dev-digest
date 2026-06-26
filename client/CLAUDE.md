# client/CLAUDE.md

Next.js 15 web app — `@devdigest/web` on :3000. Root conventions in [../CLAUDE.md](../CLAUDE.md).

## Commands

```sh
pnpm dev          # start dev server
pnpm build        # production build
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest (jsdom, no running API needed)
```

## Stack specifics

- **Next.js 15** App Router + **React 19** — see [src/app/CLAUDE.md](src/app/CLAUDE.md)
- **TanStack Query** for all server state — no `useEffect` for data fetching
- **Tailwind CSS 4** — utility-first, no CSS modules
- **Vendored UI primitives** in `src/vendor/ui/` — no Shadcn, no Radix, no external component library
- **next-intl** for i18n — all user-facing strings via translation keys, never hardcoded

## Key conventions

- `apiFetch` / `api.*` from `src/lib/api.ts` is the only entry point for API calls
- No global state store — everything is server state (React Query) or local component state
- Feature components are co-located with their page in `_components/<Name>/` — see [src/app/CLAUDE.md](src/app/CLAUDE.md)
- Tests: vitest + jsdom with fetch mocked — no running server required

## Active features (L01)

Cost badge visible on review run cards · severity filter on the findings list.
Specs: [specs/cost-badge.md](specs/cost-badge.md) · [specs/severity-filter.md](specs/severity-filter.md)

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the most relevant entries for the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — UI route map, component diagram
- [src/app/CLAUDE.md](src/app/CLAUDE.md) — App Router conventions, RSC boundary
- [src/lib/CLAUDE.md](src/lib/CLAUDE.md) — hooks, API client, QueryKey conventions
- [docs/](docs/) — design decisions
- [specs/](specs/) — feature specs
- [insights.md](insights.md) — accumulated gotchas
