# CLAUDE.md — `@devdigest/web` (client)

Next.js 15 studio: import repos, browse PRs, run/read AI reviews, author agents.
App Router + React 19; data via TanStack Query over the Fastify API.
Full route map and UI structure: **[README.md](README.md)**.

## Commands (run from `client/`, pnpm)

- `pnpm dev` — Next on `:3000` · `pnpm build` · `pnpm start` · `pnpm typecheck`
- `pnpm test` — vitest + jsdom, `fetch` mocked (no API/browser needed).

## Where things live (`src/`)

- `app/**/page.tsx` — routes (App Router). Pages are **thin**; feature logic sits in
  colocated `_components/<Name>/` folders, each with its own `*.test.tsx`.
- `lib/api.ts` — single fetch client. `lib/hooks/*` — every data hook (TanStack Query).
- `components/app-shell` — cross-cutting chrome (nav, breadcrumbs, `g`-then-key shortcuts).
- `i18n/` + `messages/<locale>/*.json` — next-intl. `vendor/ui` = `@devdigest/ui`,
  `vendor/shared` = `@devdigest/shared` (Zod contracts).

## Non-default conventions

- **All server data flows through `lib/hooks/*` → `lib/api.ts`.** Don't `fetch` in components.
- **API base:** `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).
- Types come from `@devdigest/shared` contracts — don't redeclare response shapes locally.
- User-facing strings go through next-intl messages, not hardcoded literals.

## Testing

Component/interaction tests (`*.test.tsx`) under vitest + jsdom with `fetch` mocked — no API,
no browser. Real browser journeys live in [../e2e](../e2e/CLAUDE.md). See [../TESTING.md](../TESTING.md).

## On-demand docs

[README.md](README.md) · [docs/](docs) (design notes) · [specs/](specs) ·
[INSIGHTS.md](INSIGHTS.md) (gotchas & decisions log)
