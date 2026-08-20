---
name: frontend-ui-architecture
description: "Frontend UI architecture and code organization for React + Next.js App Router. Use when deciding where files and components live, how to split a component, where business logic / constants / utils / types / config belong, how to structure features and the API layer, or where Server Actions and data access go. Structural decisions only — hooks/state/performance rules live in react-best-practices; RSC and file-convention mechanics live in next-best-practices."
version: 1.0.0
---

# Frontend UI Architecture

Where code lives and how it is layered in a React + Next.js (App Router) app.
Distilled from ~50 sources (official docs, reference architectures, maintainer
writing) — every claim is sourced in [README.md](README.md).

Sibling skills — do not duplicate their territory:
- `react-best-practices` — hooks rules, state patterns, memoization, rendering anti-patterns
- `next-best-practices` — RSC boundary mechanics, file conventions, async APIs, caching, bundling

## Core Principles

1. **Colocation is the default; sharing is earned.** Place code as close to its
   consumer as possible; extract to a shared location only on demonstrated reuse.
   Shared code is discovered during development, not planned up front.
2. **The promotion ladder.** Inside the component → file level (same module) →
   feature-local (`<feature>/utils`, `<feature>/types`) → shared layer.
   Trigger to promote: a **second feature** needs it. Demote symmetrically: a
   "shared" util used by one feature moves into that feature.
3. **Unidirectional imports: shared → features → app.** Features import only
   from shared; the app layer composes features; nothing imports upward. No
   cross-feature imports — compose features at the app/route level. Enforce
   mechanically (ESLint `import/no-restricted-paths` or `eslint-plugin-boundaries`),
   not by convention.
4. **Consistency beats the specific choice.** A mediocre structure applied
   uniformly outperforms a perfect one applied inconsistently.

## Folder Structure

- Structure is an **evolution matched to app size**, not a day-one decision:
  technical folders (`components/`, `hooks/`, `utils/`) are fine for small/mid
  apps; move to feature folders when the components folder stops scaling.
- **Shared vs feature components:** domain-agnostic primitives (Button, Modal,
  design-system pieces) live in a shared UI folder; anything that references a
  domain concept stays inside its feature. Promote feature → shared only when a
  second feature actually needs it.
- One folder per component for shared components: the component plus its
  subcomponents, helpers, types, and tests tucked inside; tests sit next to
  source, never in mirrored `test/` trees (E2E is the exception).
- Cap folder nesting at **3–4 levels**; use absolute import aliases (`@/…`)
  instead of deep relative paths.
- **Barrel files (`index.ts` re-exports): avoid inside app code.** They inflate
  the dev module graph, cause accidental circular imports, and defeat
  tree-shaking; they are legitimate only as a *library's* public entry point.
  A single-component forwarder `index.ts` is a tolerated edge case — never
  wide re-export barrels.

## Component Splitting

- Split on **responsibility, not size**: one concern per component, boundaries
  mirroring the data model. No respected source gives a line-count or
  prop-count threshold — treat "many props" as a prompt to examine, not a rule.
- **Split signals:** part of it needs reuse; *incompatible props* (props that
  can't meaningfully combine — two components wearing one interface); state
  becoming hard to follow; tests getting unwieldy; re-render cost; constant
  merge conflicts on one file.
- **Counter-signal:** don't split or abstract speculatively — prefer duplication
  over the wrong abstraction; wait until the commonalities are obvious. When an
  abstraction turns wrong, re-inline it into callers and re-abstract from
  evidence.
- **Composition over configuration:** when a component sprouts boolean/variant
  props, reach for `children`, slots, or compound components (parent owns
  state, `Menu.Item`-style children consume via context) instead of more flags.
- Two canonical composition moves: **move state down** (extract the stateful
  fragment into its own component) and **lift content up** (pass stable
  subtrees as `children`). Do these before reaching for `memo`.
- **Mutually exclusive UI states** (loading / error / empty / data) are separate
  early-return branches sharing a small local `Layout` component — not nested
  ternaries. Duplicating the layout wrapper per branch is fine; branches then
  evolve independently.
- **Container/presentational is retired as a rule** (per its own author). The
  how-it-works vs how-it-looks separation survives as: custom hooks for logic,
  and — only when one behavior needs several visual skins or independent
  testing — headless components. Don't default to headless for app code.
- One component per file is **not** a rule: a private subcomponent with exactly
  one parent stays in the parent's file and moves out only when shared, tested
  independently, or contended in reviews.

## Business Logic Placement

The three-band model — dependencies point inward only, never the reverse:

| Band | Holds | Tested via |
|------|-------|-----------|
| Components | rendering, event wiring | render tests |
| Custom hooks | orchestration: state, effects, query composition | `renderHook` |
| Plain TS modules | business rules, calculations, validation, mapping | direct unit tests |

- **Hook vs plain function is official policy:** a function that calls no hooks
  is a plain function — no `use` prefix. The dividing line is testability: if
  it doesn't need React to run, it isn't a hook.
- **Components never fetch directly.** The API layer is: one preconfigured
  client instance → per-endpoint typed fetcher + schema → a custom query hook
  per resource as the only surface components touch. Query keys and fetchers
  never appear in components.
- **DTO → domain mapping lives in the API layer.** Raw backend shapes
  (snake_case fields, transport quirks) must not leak into UI code.
- **Server state ≠ client state.** The query cache owns freshness, retries, and
  invalidation — never copy query data into a store or local state (tune
  `staleTime` instead). After that split, global client state is tiny (theme,
  UI prefs); keep it minimal.
- **Business logic in `useEffect` is the canonical anti-pattern**: derived
  state, user-action logic, and effect chains all belong elsewhere (render-time
  derivation, event handlers, `key`-reset). Effects are only for synchronizing
  with external systems.
- **Forms:** the zod schema *is* the validation layer — its own file (or
  colocated with the endpoint declaration), wired via resolver, with `z.infer`
  as the single source for both rules and types.
- **State machines (XState)** only for flag-explosion flows (wizards, payment
  steps); the machine definition is framework-agnostic logic outside React.
  Overkill for CRUD screens.

## Constants, Utils, Types, Config

- **Constants colocate** at the top of the file that uses them; a `constants.ts`
  is justified per feature or for genuinely app-wide values (routes, limits) —
  never one global dumping file. `SCREAMING_SNAKE_CASE` for exported
  build-time constants; camelCase for file-local ones. No magic numbers/strings
  inline.
- **`as const` objects + literal unions over enums** (official TypeScript
  position). Literal unions for compile-time-only sets; `as const` object +
  `typeof X[keyof typeof X]` when runtime values or iteration are needed;
  `const enum` never in shared code.
- **No `utils.ts` grab-bag.** Utility modules are named by domain
  (`format-date.ts`, `currency.ts`); a helper serving one domain lives in that
  domain; prefer duplication over coupling two unrelated features through one
  shared helper. Delete utils orphaned by their last caller.
- **Pure functions go outside the component body** at file level — signals
  purity, avoids per-render re-creation, and makes them importable in tests.
  A separate file comes later, when reuse appears.
- **Types colocate by default**: prop types in the component file, feature
  types in the feature. A shared `types/` holds only cross-cutting and API
  contract types. `import type` for type-only imports, enforced by lint
  (`consistent-type-imports`) or `verbatimModuleSyntax`.
- **Env/config: one typed, schema-validated module** (zod-parsed `env.ts`) that
  fails at build/startup; the app imports the validated object — `process.env`
  reads never scatter beyond it.

## Next.js App Router Architecture

- **`app/` is a thin routing layer.** A `page.tsx` reads like orchestration:
  import a page-level component, pass params, return UI. Real code lives in
  feature/shared folders (in this repo: `_components/`, `components/`, `lib/`).
- **Server components by default; `'use client'` at the leaves.** The directive
  is a one-way module-graph door — everything imported below it ships to the
  browser, so file placement is an architectural decision. Extract minimal
  client wrappers and pass server-rendered content in as `children`. No
  `*.client.tsx` suffix convention exists in respected sources — the split is
  signaled by folder placement (`_components/`, feature slices).
- **Data access is a layer, not a sprinkle.** Official doctrine names three
  models — pick one, don't mix: Data Access Layer over your own DB
  (server-only module, authorization inside every function, minimal DTOs out),
  external HTTP API, or component-level access (prototypes only).
- **This project is the "External HTTP APIs" case**: the client fronts the
  separate Fastify server, so there is no DAL-over-DB here — the typed API
  client plus `vendor/shared` contracts play the DAL role, and the same
  discipline applies to that layer (server-only where applicable, DTO
  boundary, centralized auth handling).
- **Server Actions are thin controllers** — validate → call the data layer →
  revalidate. Every action is a public POST endpoint regardless of where it's
  used: re-authenticate, re-check ownership (IDOR), zod-validate arguments,
  and filter return values inside each one. Colocate action files per
  feature/route, not in one global file.
- **Never fetch your own route handlers from Server Components** — fetch
  directly from the source. Route handlers exist for external consumers,
  webhooks, and non-HTML responses; Server Actions are for mutations only.
- Use **route groups** `(group)` for section/auth-tier layouts and **private
  folders** `_folder` for non-routable colocated code.

## This Repo (`client/`)

Current shape the rules apply to: Next.js App Router; route-private
`_components/` inside `app/` segments; shared `components/` with a kebab-case
folder per component (subcomponent folders inside); `lib/` + `lib/hooks/`;
vendored UI kit in `vendor/ui/`; hand-synced API contracts in `vendor/shared/`
(canonical copy is `server/src/vendor/shared/` — see root `INSIGHTS.md`).
Speak to this shape — do not prescribe a from-scratch `features/` migration.

## Known Judgment Calls

Where respected sources genuinely disagree — pick per situation, don't present
either side as law:

- **Feature folders vs function folders** at scale (consensus vs Josh Comeau).
- **Feature code inside `app/` (route colocation) vs outside** (`src/features`);
  route segments are URL-shaped, features are domain-shaped — external folders
  survive URL restructures.
- **`lib/` vs `utils/` vs `helpers/` vocabulary** — no winner; one scheme per
  project, applied consistently.
- **Layering depth** — official guidance stops at a data layer + thin actions;
  handler/service/repository strata pay off only at scale. Both a flat
  dumping ground and premature enterprise layering are failure modes.
- **API-layer granularity** — one file per endpoint vs grouped by entity.
- **Split-when-it-grows vs split-when-it-hurts** — middle ground: split along
  state and UI-state boundaries.
