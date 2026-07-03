# client (@devdigest/web) — agent guide

Next.js 15 (App Router) + React 19 studio UI for DevDigest. Talks only to the API.

## Where things live
- `src/app/**` — App Router pages, kept **thin**; feature logic lives in colocated `_components/<Name>/`.
- `src/lib/api.ts` — all `fetch` calls; hooks in `src/lib/hooks/*` (TanStack Query). API base = `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).
- `messages/<locale>/*.json` — i18n strings (`next-intl`). Add user-facing copy here, not inline.
- `src/vendor/ui` — `@devdigest/ui` primitives; `src/vendor/shared` — Zod contracts (mirror of the server copy).

## Routes
`/` (repo PR list) · `/repos/:repoId/pulls[/:number]` · `/agents[/:id]` · `/settings/:section` · `/onboarding`.

## Conventions
- Tailwind v4 (via `@tailwindcss/postcss`); design tokens as CSS vars (e.g. `--text-muted`).
- Findings UI: `pulls/[number]/_components/` → `FindingsTab` → `ReviewRunAccordion` → `FindingsPanel` → `FindingCard`. Severity colors: `FindingCard/constants.ts` `SEV_COLOR` (CRITICAL/WARNING/SUGGESTION).
- PR-list columns/grid are declared in `repos/[repoId]/pulls/constants.ts`.

## Tests
Vitest + jsdom, `fetch` mocked (no API/DB/browser). Colocated `*.test.tsx`. Run: `pnpm test` + `pnpm typecheck`.
