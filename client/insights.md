# insights.md — client

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2025-06-01 [Mistake]** — Hardcoding English strings in JSX bypasses `next-intl` and breaks non-English locales. Add a key to `messages/<locale>/` and use `useTranslations()` in the component — never inline English text, even temporarily.

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2025-06-01 [Decision]** — All UI primitives (Button, Card, Badge, Dialog, etc.) live in `src/vendor/ui/`; there is no Shadcn, Radix, or Headless UI dependency. When adding a new primitive, extend `src/vendor/ui/` rather than installing an external component library. `client/src/vendor/ui/`
- **2025-06-01 [Decision]** — No global state store: all server-derived state goes through TanStack Query and local UI state uses `useState`/`useReducer`. To share data between components, use the same QueryKey — React Query deduplicates fetches automatically.

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2025-06-01 [Quirk]** — Next.js 15 changed `params` and `searchParams` to `Promise<{...}>`; always `await params` before destructuring, even in async Server Components. TypeScript catches this only if the page signature is correctly typed.
- **2025-06-01 [Quirk]** — Client tests use vitest + jsdom with `fetch` fully mocked — no running server or Docker required. When a test fails with a 404 or network error, a mock is missing, not the server.
- **2026-06-26 [Quirk]** — `@devdigest/shared` maps in the client to `./src/vendor/shared/index.ts` — a separate copy from `server/src/vendor/shared/`. Whenever a shared contract changes, both copies must be updated in the same commit or the client typecheck fails silently. `client/src/vendor/shared/contracts/`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-06-27 · Entries: 6
