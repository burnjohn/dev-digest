# CLAUDE.md — client (`@devdigest/web`)

Next.js 15 (App Router) + React 19 web app — "the studio". Talks to
`server` over REST via TanStack Query. Port 3000. Full picture:
[README.md](README.md).

## Docs map

- [README.md](README.md) — setup, route map, env vars
- [docs/](docs/) — architecture/design deep-dives for this package
- [specs/](specs/) — page/flow/component contracts owned by this package
- [Insights.md](Insights.md) — gotchas and decisions learned while building this package
- Root docs also apply: [../README.md](../README.md), [../TESTING.md](../TESTING.md)

## Commands

```bash
pnpm dev            # next dev -p 3000
pnpm typecheck
pnpm test           # vitest + jsdom + @testing-library/react
pnpm build && pnpm start
```

## Conventions & gotchas

- Package manager is **pnpm**, not npm.
- `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`) points at
  `server` — the API must be running for anything beyond static pages.
- Request/response types come from `@devdigest/shared`, aliased in from
  `server/src/vendor/shared` — don't hand-roll duplicate types for API
  responses.
- Route map lives under `src/app/**/page.tsx`; see `README.md` for the
  current tree (repos → pulls → review detail, agents, settings, onboarding).
- Before starting work here, read [Insights.md](Insights.md) and treat it as
  high-confidence guidance. At session end, if something non-obvious was
  learned, append it (read the file first to avoid duplicating an existing
  entry) — see the `engineering-insights` skill.
