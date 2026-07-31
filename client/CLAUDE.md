# client — the studio UI (`@devdigest/web`, Next.js 15, :3000)
↑ [Root map](../CLAUDE.md)

Map of this module for AI agents. Overview & diagrams live in the README (linked
below) — this file is the map, not the docs.

## Stack & commands
- Next.js 15 (App Router), React 19, TanStack Query, `next-intl`, `recharts`,
  `mermaid`, `react-markdown`.
- `pnpm dev` (:3000) · `pnpm build` · `pnpm test` (vitest + jsdom, `fetch` mocked
  — no API/browser needed) · `pnpm typecheck`.
- API base: `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).

## Map (where things live)
| Path | Purpose |
|------|---------|
| `src/app/**/page.tsx` | routes (thin pages) |
| `src/components/app-shell` | nav, breadcrumbs, `g`-then-key shortcuts |
| `src/lib/hooks/*` | TanStack Query data hooks (one per API surface) |
| `src/lib/api.ts` | HTTP client — the single fetch chokepoint |
| `src/i18n` + `messages/<locale>/*.json` | localized strings |
| `src/vendor/ui` (`@devdigest/ui`), `src/vendor/shared` (`@devdigest/shared`) | vendored primitives & Zod contracts |

## Conventions (non-default)
- Pages are thin; feature logic sits in colocated `_components/<Name>/` folders,
  each with its own `*.test.tsx`.
- All data access goes through `src/lib/hooks/*` → `src/lib/api.ts` — don't fetch
  ad hoc in components.

## Do-not-touch
- `src/vendor/*` — vendored copies (UI primitives + shared Zod contracts). Edit at
  the source, not here.

## Read when…
- Read `./README.md` for the UI route map (mermaid) & stack detail.
- Read `./docs/README.md` when you need deeper UI architecture / design notes.
- Read `./specs/README.md` when changing behavior covered by a spec.
- Read `./INSIGHTS.md` at the START of any task here; append substantial,
  non-duplicate insights at the END (engineering-insights skill).
- Read [`../e2e/README.md`](../e2e/README.md) for real browser journeys.
