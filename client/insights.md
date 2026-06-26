# client/insights.md

Accumulated non-obvious findings about `@devdigest/web`. Add an entry whenever something surprises you.

---

## 2025-06 No external UI component library — vendored primitives only

**Context**: Adding a new UI element and reaching for Shadcn or Radix.
**Discovery**: All UI primitives (Button, Card, Badge, Dialog, etc.) live in `src/vendor/ui/`. There is no Shadcn, no Radix, no Headless UI dependency. Components are hand-built for full control over styling and behaviour.
**Impact**: Don't install external component libraries. Extend `src/vendor/ui/` for new primitives. When in doubt, copy-adapt an existing primitive rather than importing a new package.
**Status**: current

---

## 2025-06 Route params are a Promise in Next.js 15

**Context**: Accessing `params.id` in a page component and getting a type error or runtime `undefined`.
**Discovery**: Next.js 15 changed `params` (and `searchParams`) to be `Promise<{...}>`. You must `await params` before destructuring, even in async Server Components.
**Impact**: Always write `const { id } = await params` — not `const { id } = params`. The TypeScript type catches this if the page signature is typed correctly.
**Status**: current

---

## 2025-06 Tests run without a live API — fetch is fully mocked

**Context**: Running `pnpm test` and expecting to need the server running.
**Discovery**: The test suite uses vitest + jsdom. All `fetch` calls are mocked at the test level. No server or Docker is required.
**Impact**: Client tests are fast and fully hermetic. When a test fails due to a 404 or network error, the mock is missing — not the server.
**Status**: current

---

## 2025-06 TanStack Query is the only server state — no Redux, no Zustand

**Context**: Looking for a global store to share state between components.
**Discovery**: There is no global state store. All server-derived state is managed by TanStack Query (React Query). Local UI state uses `useState` / `useReducer`. The QueryClient is the cache.
**Impact**: To share data between components, use the same QueryKey — React Query deduplicates fetches. Don't reach for a store; model it as a query instead.
**Status**: current

---

## 2025-06 i18n strings are required — no hardcoded English

**Context**: Adding a label or button and writing the string directly in JSX.
**Discovery**: The app uses `next-intl`. All user-facing strings must go through translation keys in `messages/<locale>/`. Hardcoded strings bypass the i18n layer and break non-English locales.
**Impact**: Add a key to the relevant messages file, then use `useTranslations()` in the component. Don't hardcode English strings even for "temporary" UI.
**Status**: current

---

## 2026-06-26 @devdigest/shared resolves to the CLIENT's own vendor copy — not the server's

**Context**: Updating a shared contract in `server/src/vendor/shared/contracts/` and then getting TypeScript errors in the client.
**Discovery**: The client's `tsconfig.json` maps `@devdigest/shared` → `./src/vendor/shared/index.ts`. This is an entirely separate copy of the contracts files at `client/src/vendor/shared/contracts/`. The server's `server/src/vendor/shared/` is the authoritative source, but the client does not read it — it has its own duplicate.
**Impact**: Whenever a cross-package contract changes (e.g., `RunSummary`, `PrMeta`, `RunStats`), both `server/src/vendor/shared/contracts/*.ts` AND `client/src/vendor/shared/contracts/*.ts` must be updated in the same commit. The client typecheck will fail silently until both copies match. `client/src/vendor/shared/contracts/`
**Status**: current

---
*Last updated: 2026-06-26 · Entries: 6*
