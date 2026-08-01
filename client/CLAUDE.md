# client/ — @devdigest/web

Next.js 15 App Router UI for the DevDigest studio.

## Stack

- Next.js 15, React 19, TypeScript 5.7, Tailwind v4
- TanStack Query for data fetching (hooks in `src/lib/hooks/`)
- `next-intl` for i18n (messages in `messages/en/*.json`)
- Recharts, Mermaid, react-markdown for visualizations
- Vendored UI primitives: `src/vendor/ui/` (`@devdigest/ui`)

## Commands

```sh
pnpm dev         # web on :3000
pnpm test        # vitest + jsdom (no API needed, fetch mocked)
pnpm typecheck   # tsc --noEmit
pnpm build       # production build
```

## Where things live

- `src/app/` — App Router pages: `repos/`, `agents/`, `settings/`, `onboarding/`
- `src/app/*/_components/<Name>/` — colocated feature components + `*.test.tsx`
- `src/lib/api.ts` — API client (base URL from `NEXT_PUBLIC_API_BASE`)
- `src/lib/hooks/` — TanStack Query hooks (one per API resource)
- `src/components/app-shell/` — nav, breadcrumbs, keyboard shortcuts (`g`-then-key)
- `src/vendor/shared/` — `@devdigest/shared` Zod contracts (symlinked from server)
- `src/vendor/ui/` — `@devdigest/ui` vendored components
- `messages/en/*.json` — i18n strings per feature

## Conventions

- Pages are thin wrappers; feature logic lives in `_components/` folders
- All API data goes through TanStack Query hooks, never raw fetch in components
- Path alias `@/*` → `./src/*`, plus `@devdigest/shared` and `@devdigest/ui`
- Tests mock fetch, not the API — no server needed for component tests

## Gotchas

- `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001` — must match the running API
- Shared contracts come from `src/vendor/shared/` — the client copy, not server's

## Do not touch

- `src/vendor/ui/` — vendored UI kit, modify only when updating the design system
- `src/vendor/shared/` — shared contracts, coordinate across packages

## Deep docs (read on demand)

- [INSIGHTS.md](INSIGHTS.md) — what past sessions learned in this package; read before non-trivial work
- [README.md](README.md) — UI route map (mermaid), testing strategy
- [../TESTING.md](../TESTING.md) — CI workflow details
- [../e2e/](../e2e/README.md) — browser e2e flows that test this app
