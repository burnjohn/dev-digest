# client (`@devdigest/web`) — agent notes

## Commands

```sh
pnpm dev          # next dev, :3000
pnpm build
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest + jsdom, fetch mocked — no API needed
```

## Conventions

- App Router. Pages (`src/app/**/page.tsx`) stay thin; feature logic lives in
  colocated `_components/<Name>/` folders, each with its own `*.test.tsx`.
- All data access goes through a hook in `src/lib/hooks/*`, which calls
  `src/lib/api.ts`. Components never call `fetch` directly.
- Server state is TanStack Query. Do not mirror it into `useState`.
- User-facing strings go through `next-intl` — add them to
  `messages/<locale>/*.json`, never inline literals in JSX.
- Types for API payloads come from `@devdigest/shared`. Do not redeclare them.
- Cross-cutting chrome (nav, breadcrumbs, `g`-then-key shortcuts) lives in
  `src/components/app-shell`.

## Gotchas

- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`). It is
  read at build time — changing `.env` needs a dev-server restart.
- Tests mock `fetch`, so a passing test proves nothing about real API shape. The
  contract is enforced by `@devdigest/shared`, and the real journey by `../e2e`.

## Do not touch

- `src/vendor/ui` (`@devdigest/ui`) and `src/vendor/shared` — vendored. Change
  `vendor/shared` only as a deliberate contract change, server side first.

## Read when

- Read `INSIGHTS.md` first for what was already tried here, and run the
  `engineering-insights` skill at the end of the task to add to it.
- Read `README.md` for the UI route map and which endpoints each page leans on.
- Read `../server/README.md` when you need the exact shape of an endpoint.
- Read `../e2e/README.md` when a change affects a seeded browser flow.
