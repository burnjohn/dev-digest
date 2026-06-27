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

**PR list (`repos/[repoId]/pulls`):**

- FINDINGS column: all 3 severity types (AlertOctagon/AlertTriangle/Lightbulb + count) always shown when total > 0; 0-count badges at 45% opacity with full severity color. Grid: `"1fr 132px 92px 60px 120px 118px 80px 110px 78px"` (9 cols — added `actions` column between COST and UPDATED)
- Run Review button: own `actions` column, `kind="secondary"` (dark), always visible (not hover-conditional); popup portaled to `document.body` via `createPortal`
- Cost badge in COST column via `cost_usd` from API

**PR detail (`repos/[repoId]/pulls/[number]`):**

- Timeline (`RunHistory`): severity badges icon+count only, no borders/labels; click-to-preview popup reuses `usePrReviews` cache (no extra fetch)
- FindingsPanel: severity filter pills with icons; `activeSeverity` + `focusIdx` reset via `runId` prop (more reliable than `findings[0]?.id`)
- FindingsPopup (PR list row) shows findings from latest review only, matching badge count
- Overview tab: VerdictBanner + Intent + Blast Radius cards from `usePrBrief`; placeholder "not generated" cards when `brief=null` but review exists

**Severity icon convention:** CRITICAL → `Icon.AlertOctagon` · WARNING → `Icon.AlertTriangle` · SUGGESTION → `Icon.Lightbulb` — consistent across RunHistory, FindingsPanel, PRRow.

`usePrBrief(prId)` loads `GET /pulls/:id/brief` lazily with `staleTime: 5 min`.

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
