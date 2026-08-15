---
name: frontend-ui-architecture
description: "Where React/Next.js code goes — file and folder placement, not code style.
  Use when creating any new client file, adding a page or component, deciding between colocating
  and sharing, naming files, placing tests, or reviewing/refactoring project structure. Covers
  App Router page layout, _components colocation, shared vs feature code, promotion thresholds,
  and import boundaries. Use this even when the user just asks 'where should this go?' or starts
  a new frontend app without mentioning architecture."
metadata:
  version: "1.0.0"
---

# Frontend UI Architecture

Answers exactly one question: **where does this piece of client code live?**
Which file, which folder, which layer, which imports are allowed, what to call it.

Everything here is checkable by looking at a file *tree* — not at code. The test for whether a
rule belongs in this skill: *could you violate it without changing a single line inside a file,
only by moving or renaming the file?* If not, it belongs to another skill (see
[Adjacent, not covered here](#9-adjacent-not-covered-here)).

Use the prescribed structure below as the default. It is one coherent answer, not a survey of
options — a team that picks any consistent structure beats a team that debates structure. Next.js
is explicitly unopinionated here ("choose a strategy that works for you and your team and be
consistent across the project"), so the consistency matters more than this particular shape. The
[escape hatches](#7-escape-hatches) say when to deviate.

---

## 1. The prescribed structure

```
src/
├── app/                                   # ROUTING ONLY
│   ├── layout.tsx
│   ├── (marketing)/pricing/page.tsx       # route group: groups files, not URLs
│   └── repos/[repoId]/pulls/
│       ├── page.tsx                       # thin: read params → call loader → compose
│       ├── _components/                   # private folder: this route's components
│       │   └── pr-row/
│       │       ├── pr-row.tsx
│       │       ├── pr-row.test.tsx        # test next to source
│       │       ├── constants.ts
│       │       └── helpers.ts
│       ├── _lib/                          # loaders/logic for this route only
│       └── constants.ts
├── components/                            # shared UI — arrives here on the 2nd consumer
├── lib/                                   # shared non-UI: api client, utils, config
├── server/                                # DAL: `import 'server-only'`, authz, DTOs
└── styles/
e2e/                                       # end-to-end tests at the project root
proxy.ts                                   # Next.js 16+ (was middleware.ts) — project root
```

Four rules carry this tree:

1. **`app/` is routing.** A folder under `app/` exists because it maps to a URL segment. Files
   that are not routes live in `_`-prefixed folders or outside `app/` entirely.
2. **Pages are thin.** `page.tsx` reads `params`/`searchParams`, calls a loader, composes
   components. Business logic in a page cannot be reused, tested, or moved.
3. **Default to colocation.** New code starts next to its only consumer. It moves up only when a
   second consumer appears.
4. **`src/server/` is the only place that touches the database, secrets, or `process.env`.**

**Private folders (`_folder`) are a real mechanism, not decoration.** Prefixing with `_` opts the
folder *and all its subfolders* out of routing. Colocation already works without them — a file
under `app/` is not routable unless it is `page`/`route` — but the Next.js docs give a concrete
reason to use them anyway: avoiding naming collisions with *future* Next.js file conventions, plus
separating UI from routing and grouping files in editors. That is a technical argument, so `_`
folders are the default here rather than a matter of taste.

**Non-Next.js React (Vite, CRA, React Router):** replace `app/` with `src/routes/` or
`src/features/`, drop the `_` prefixes (nothing to opt out of), keep everything else — thin
route components, colocation by default, promotion on the second consumer, one import direction.

---

## 2. What goes where

The core table. Each row answers a placement question directly.

| What | Where | Rule |
|---|---|---|
| Page | `app/<segment>/page.tsx` | thin — no business logic |
| Layout / loading / error UI | `app/<segment>/{layout,loading,error}.tsx` | framework file conventions, never renamed |
| Component used by 1 page | `app/<segment>/_components/` | colocation is the default |
| Component used by 2+ routes | `src/components/` | promote on the 2nd consumer |
| Component used by 2+ routes *in one section* | that section's route-group `_components/` | don't jump straight to global |
| Constant used in 1 file | top of that file | |
| Constant used across 1 route | `app/<segment>/constants.ts` | |
| Constant used app-wide | `src/lib/config.ts` | env access included |
| Helper (knows your domain) | `helpers.ts` next to its consumer | helpers ≠ utils |
| Util (generic, domain-free) | `src/lib/utils/` | could be published as a package unchanged |
| Hook | next to its consumer if one; `src/hooks/` when shared | `use-` prefix **only** if it calls a hook |
| Pure function | ordinary module, no `use-` | `getSorted`, not `useSorted` |
| API/contract type | import from the shared contract; never re-declare | one source of truth per type |
| UI-local type | `types.ts` next to the component | props, view models |
| Client-side data fetching | `src/lib/api/` + hooks | |
| Server-side data access | `src/server/` DAL with `import 'server-only'` | authz inside; returns DTOs |
| Server Action | `app/<segment>/actions.ts`, delegating to the DAL | thin, like pages |
| Unit / component test | `x.test.tsx` beside `x.tsx` | |
| E2E test | `e2e/` at the project root | separate runner, separate lifecycle |
| Static asset | `public/` (served) or beside the component (imported) | |

**helpers vs utils** is the distinction people get wrong most often. `formatPrDiffStat()` knows
what a PR is → `helpers.ts` beside the PR code. `clamp()`, `groupBy()` know nothing about your
product → `src/lib/utils/`. When `utils.ts` grows past a screen, it is almost always because
domain helpers leaked into it; split them back out by domain rather than by adding sub-files.

**Data access is a placement rule, not just a security one.** The Next.js data-security guide
recommends a Data Access Layer for new projects: it runs only on the server, performs the
authorization checks, and returns minimal DTOs — and *only* the DAL reads `process.env`. That is
why `src/server/` is a folder in this structure: if DB calls sit in pages, there is no single
place an auditor can check.

---

## 3. Colocation and promotion

```
1 consumer   → colocate next to it
2 consumers  → promote to the nearest shared folder that covers both
3 repetitions → now consider an abstraction (not before)
```

Promotion is a *move*, not a copy: the file leaves the route folder and the route imports it from
its new home. Promote to the **nearest** common ancestor — two routes inside `(shop)` share via
`app/(shop)/_components/`, not via `src/components/`.

Never promote speculatively. A `shared/` folder with one consumer is a guess about the future,
and the guess is usually wrong: "prefer duplication over the wrong abstraction" (Sandi Metz, quoted
by Kent C. Dodds in *AHA Programming*). The second consumer is when sharing becomes a fact; the
third repetition is when an abstraction has enough evidence to be shaped correctly.

Demotion is legal and under-used: when a shared component ends up with one consumer again, move it
back down. Structure follows current usage, not history.

---

## 4. Naming

- **`kebab-case` for files and folders** — `pr-row.tsx`, `use-review-run.ts`. Case-only renames
  behave differently on case-insensitive filesystems (macOS, Windows) than in CI (Linux), which
  produces bugs that reproduce on one machine only. `PascalCase.tsx` is a widely used, valid
  alternative; if a codebase already uses it, keep it. Consistency beats the choice.
- **`PascalCase` for the component identifier** inside the file, regardless of the file name.
- **One default export per component file**, named the same as the file.
- **Singular for domain folders** (`repo/`, not `repos/`) except route segments, where the URL
  decides.
- **`use-` prefix only for real hooks** — a function that calls a hook. A pure function named
  `useSorted` makes React's rules-of-hooks linting and every reader wrong at once.
- **Suffix by role, not by type**: `pr-row.test.tsx`, `pr-row.stories.tsx`, `types.ts`,
  `constants.ts`, `helpers.ts`. Avoid `pr-row-component.tsx` — the folder already says it.
- **Never rename framework files.** `page.tsx`, `layout.tsx`, `route.ts`, `proxy.ts` are
  conventions, not choices. (Next.js 16 renamed root `middleware.ts` → `proxy.ts`; most community
  articles predate this.)

---

## 5. Import boundaries

One direction only:

```
shared (components, lib, hooks, types)  →  features / routes  →  app
```

- Shared code never imports from a route or a feature. If it needs to, it is not shared.
- **A route never imports from another route.** If two routes need the same thing, promote it.
  Composition happens one level up, never sideways.
- `@/` path aliases across modules; relative paths *inside* a module. `../../` in an import is a
  boundary violation with extra steps — ban it in the linter.
- `src/server/` is imported by server components and actions only. `import 'server-only'` at the
  top of each DAL module turns a violation into a build error rather than a leak.

**Structure is a wish until a linter enforces it in CI.** Folder names do not stop anyone, index
files do not stop deep imports, and code review catches this inconsistently. Set the boundaries up
once: `references/eslint-boundaries.md` has a verified flat config using `eslint-plugin-boundaries`
(element descriptors + `boundaries/dependencies` policies), `import/no-restricted-paths` for the
layer direction, `no-restricted-imports` against `../../`, and `import/no-cycle`.

---

## 6. Barrel files (`index.ts` re-exports)

**Position: do not use barrel files in application code.** Get the public-API guarantee from the
linter instead — one `boundaries/dependencies` policy restricts which file of a module others may
import (`fileInternalPath: '!index.*'`), which is exactly what a barrel is *supposed* to buy,
without the runtime cost. The config is in `references/eslint-boundaries.md`.

Exception: published libraries, where the barrel *is* the package entry point declared in
`package.json`.

This is contested, and the disagreement is worth knowing:

- **Against:** TkDodo measured pages loading 11k modules and 5–10s dev startup drop to ~3.5k
  modules after removing internal barrels; they also cause circular imports and defeat
  `optimizePackageImports`. bulletproof-react explicitly reversed its earlier advice to use them
  ("it can cause issues for Vite to do tree shaking").
- **For:** Feature-Sliced Design treats the slice's public API as a contract that protects
  consumers from internal refactors — a real benefit, and it warns against `export *` for the
  same discoverability reasons.

Both sides want encapsulation. Only one of them pays for it at runtime, so take the guarantee from
the lint rule.

---

## 7. Escape hatches

- **Small app (< ~20 components).** Stay flat: `src/components/`, `src/lib/`, routes. Introduce
  route-level `_components/` at the first route that owns 3+ components of its own.
- **Design-system-heavy code.** A function-based layout (`components/`, `hooks/`, `helpers/`,
  `utils.ts`, `constants.ts`, one folder per component with its helpers/types) is a coherent
  alternative — Josh Comeau's structure — and works well when most code is generic UI rather than
  product features.
- **Monorepo.** Folder rules stop scaling at the package boundary; move enforcement to
  two-dimensional tags (scope + type) and package-level dependency rules.
- **Existing codebase with a different convention.** Follow the existing convention. A
  half-migrated structure is worse than either structure. Migrate a whole layer at a time, or not
  at all.
- **Time budget.** Do not spend more than ~5 minutes planning structure up front. The tree above
  is a default precisely so nobody has to re-derive it; refine it when the code tells you to.

---

## 8. Anti-patterns

- **Atomic-design folders** (`atoms/`, `molecules/`, `organisms/`). Every placement becomes an
  argument about which tier a component belongs to, and the answer predicts nothing useful.
- **`components/` + `hooks/` + `utils/` as the *primary* axis in a large app.** Fowler:
  presentation-domain-data separation "should only be applied at a relatively small granularity" —
  once a layer grows, split the top level into domain modules that are internally layered. Type
  folders as the top axis scatter one feature across four directories.
- **A mirrored `__tests__/` tree.** Doubles the navigation cost and guarantees drift when files
  move. Tests belong beside their source; only E2E lives apart, because it tests the app rather
  than a module.
- **Speculative `shared/`, `common/`, `core/`.** Promotion happens on the second consumer, not on
  the intuition that there will be one.
- **Full hexagonal/clean architecture in an ordinary SPA.** Ports and adapters around a UI that
  has one consumer buys indirection you pay for on every change.
- **Business logic in `page.tsx`.** Untestable, unreusable, and it makes the route a bottleneck.
- **Deep relative imports (`../../../`).** Not a style issue: they encode a path that breaks the
  moment a file moves, and they route around every boundary rule.

---

## 9. Adjacent, not covered here

Do not import rules from these areas into a placement decision — different skills own them:

| Question | Owner |
|---|---|
| How to write the component (props, effects, state, memoization) | `react-best-practices` |
| What `'use client'` / `'use server'` *do* and RSC semantics | `next-best-practices` |
| Bundle size, rendering performance, data-fetching waterfalls | `vercel-react-best-practices` |
| Type design, generics, `tsconfig` | `typescript-expert` |
| How to write the tests inside the file | `react-testing-library` |
| Accessibility and visual design | `web-design-guidelines` |

Placement questions that *look* like these: "where does this hook go" is placement; "should this be
a hook at all" is not.

---

## Reference files

Read on demand — they are not needed for most answers:

- **`references/decision-checklist.md`** — mechanical walkthrough for "I have a new file, where
  does it go?" Use it when the answer is not obvious from the table in §2, or when reviewing a PR
  that adds files.
- **`references/examples.md`** — before/after folder trees for the four common failure modes: a
  flat app that outgrew itself, a bloated `utils.ts`, a route importing from another route, a page
  holding business logic. Use it when explaining or executing a restructure.
- **`references/eslint-boundaries.md`** — a verified flat config that enforces §5 in CI. Use it
  whenever someone agrees to the boundaries; unenforced structure decays.
