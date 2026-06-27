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
- **2026-06-27 [Quirk]** — `findings.severity` is stored UPPERCASE in Postgres ('CRITICAL'/'WARNING'/'SUGGESTION'), matching the `Severity` Zod enum. DB aggregation queries must compare with uppercase; the API response exposes lowercase keys (`{ critical, warning, suggestion }`) in the `findings_breakdown` object. Mixing case silently produces zero counts — easy to miss because the query succeeds and the UI renders nothing. `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/pulls/routes.ts`
- **2026-06-27 [Quirk]** — The L01 "severity filter" feature is a confidence toggle (`hideLow` boolean), not a severity dropdown. When `hideLow` is true, findings with `confidence < 0.65` are hidden. Severity sort (CRITICAL → WARNING → SUGGESTION) is always applied independently of the toggle. The spec name is misleading — the actual implementation is in `FindingsPanel.tsx` (`hideLow` state) and `constants.ts` (`LOW_CONFIDENCE_THRESHOLD`, `SEVERITY_ORDER`). `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/`
- **2026-06-27 [Pattern]** — Popup detail data sourced from already-fetched React Query cache rather than a new endpoint: `FindingsTab` builds `Map<run_id, ReviewRecord>` from the `usePrReviews` result and passes it as `reviewsByRunId` to `RunHistory`; clicking a severity badge filters in-memory. No new route, no extra network call. Apply when popup data is a subset of something already loaded on the page. `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`, `RunHistory/RunHistory.tsx`
- **2026-06-27 [Pattern]** — Lazy-fetch popup for list rows: wrap the data-fetching popup as a child component (`FindingsPopup`) that only mounts when popup state is non-null. The `usePrReviews(prId)` inside fires only on first click, not on page load for every PR row. Contrast with the RunHistory pattern above (cache reuse) — use this when popup data is NOT already in cache. `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`
- **2026-06-27 [Pattern]** — Severity badge always shows all 3 types when total findings > 0: remove `if (!cnt) return null` guard, render all three with 0-count at `opacity: 0.45` and full severity color. Prevents visual confusion when one run has CRITICAL only and the user expects a stable 3-column layout. `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`
- **2026-06-27 [Pattern]** — Use `ReactDOM.createPortal(popup, document.body)` for `position: fixed` popups rendered inside grid-row components. CSS `transform` on any ancestor makes `position: fixed` relative to that ancestor, not the viewport — portaling to `document.body` escapes the stacking context unconditionally. `client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx`
- **2026-06-27 [Mistake]** — `FindingsPanel` used `findings[0]?.id` as the reset dependency for `activeSeverity`/`focusIdx`. Two different runs can share a first-finding ID (seeded data), silently leaving a stale filter active. Fix: add `runId?: string` prop and use `runId ?? findings[0]?.id` as the dep — stable run-level identity. `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
- **2026-06-27 [Quirk]** — Next.js HMR file watcher on Windows can miss changes made by external tools (Claude Code edit, vim, etc.). Symptom: source file is newer than `.next/static/chunks/…/page.js` but the browser keeps serving the old bundle. Fix: delete the stale chunk file — Next.js recompiles from source on the next page request. `Ctrl+Shift+R` alone does not help if the server never recompiled. `client/.next/static/chunks/`
- **2026-06-27 [Decision]** — Run Review button moved to its own `actions` grid column (index 7, 110 px) between COST and UPDATED. Grid expanded from 8 to 9 columns: `"1fr 132px 92px 60px 120px 118px 80px 110px 78px"`. Button always visible (`kind="secondary"`, dark style), not hover-conditional. UPDATED column always shows the timestamp. `client/src/app/repos/[repoId]/pulls/constants.ts`, `PRRow/PRRow.tsx`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-06-27 · Entries: 16
