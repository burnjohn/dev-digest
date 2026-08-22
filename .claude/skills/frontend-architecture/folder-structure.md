# Folder & File Structure

Where files live, how folders evolve, naming, and where to put constants / utils / helpers.

## Contents
- [Structure strategies (scale to size)](#structure-strategies-scale-to-size)
- [Feature-based vs type-based](#feature-based-vs-type-based)
- [Colocation](#colocation)
- [Constants, utils, helpers](#constants-utils-helpers)
- [Naming conventions](#naming-conventions)
- [Anti-patterns](#anti-patterns)

## Structure strategies (scale to size)

Pick the lightest structure that fits; let it evolve. The seams reveal themselves once real code exists.

**1. Flat** — small apps / prototypes (<15–20 components). Everything under `src/` with minimal folders. Breaks down once `components/` becomes a wall of files.

**2. Type-based** — small/medium. Group by technical role:
```
src/
├── assets/      components/   pages/      routes/
├── hooks/       services/     utils/      contexts/   styles/
```
Simple and discoverable, but a single feature scatters across many folders, and `components/` bloats as it grows.

**3. Feature-based** — medium/large, multiple devs. Each feature is self-contained; type-based organization lives *inside* each feature. Expose a public API via `index.ts`.
```
src/
├── features/
│   └── reviews/
│       ├── components/   hooks/   api/   types/   utils/   index.ts
├── components/   # shared UI primitives (ui/, form/)
├── hooks/  lib/  constants/   # genuinely shared
```
High cohesion (delete a feature = delete a folder), scales with teams. Cost: the "shared vs feature-specific" boundary needs judgment.

**4. Feature-Sliced Design (FSD)** — very large apps. Layers: `entities/`, `features/`, `widgets/`, `pages/`, `processes/`, `shared/`. Adopt only when feature-based starts straining.

> "Screaming Architecture": top-level folders should announce the business domain (`reviews/`, `billing/`), not the framework.

**Starting point when unsure:** `components/`, `hooks/`, and one of `utils/`/`lib/`. Add folders as the codebase asks for them. Subdivide `components/` (`ui/`, `form/`) before it passes ~15–20 files.

## Feature-based vs type-based

| | Type-based | Feature-based |
|---|---|---|
| Mental model | organize by *what it is* | organize by *what it does* |
| Best for | small apps, beginners | growing apps, teams |
| Weakness | features scatter; `components/` bloats | "shared vs local?" boundary is fuzzy |
| Deletion | hunt across folders | delete one folder |

**Hybrid** (most midsize apps): feature folders + a shared type-based layer (`components/ui`, `lib`, `hooks`). The deciding advantage at scale is colocation.

## Colocation

> "Place code as close to where it's relevant as possible." — Kent C. Dodds

- Keep tests, styles, sub-components, and helpers next to the code they serve — don't mirror `src/` with a parallel `test/` tree.
- Colocate **state** too: lifting state higher than needed re-renders more of the tree. Keep it as close to its consumer as possible.
- Promote upward only when a real second consumer appears, and only to the **lowest common** level (don't hoist a component-specific helper to `src/utils`).

## Constants, utils, helpers

**Two placement strategies — both valid, often combined:**

1. **Co-located, per component** — when values/helpers serve one component. Keep each file under ~200 lines.
   ```
   ReviewCard/
   ├── ReviewCard.tsx
   ├── ReviewCard.constants.ts   # plural content → plural filename
   └── ReviewCard.utils.ts
   ```
2. **Top-level folders** — when shared app-wide: `constants/`, `utils/`, `helpers/` (or `lib/`).

**helpers vs utils (the distinction worth keeping):**
- **utils** = generic, abstract, reusable across *any* project (lodash-style). Must be **pure** — side effects mean it isn't a util; it belongs to a service or feature.
- **helpers** = project-specific glue; wouldn't make sense to share outside this codebase.

**Rules of thumb:**
- Extract magic numbers/strings into named constants → single source of truth, clearer intent, i18n- and feature-flag-ready.
- Isolate user-facing strings/content from logic.
- Don't create a single `utils.ts` junk drawer — group by purpose; if you can't name what a util belongs to, it probably wants a feature folder.

## Naming conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Components | `PascalCase` | `ReviewCard` |
| Functions / variables / event handlers | `camelCase` (`handle`/`on` prefix) | `handleSubmit` |
| Custom hooks | `camelCase`, `use` prefix | `useReviewRun` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_FILE_SIZE` |
| Types / interfaces | `PascalCase` | `ReviewRun` |
| HOCs | `with` prefix | `withAuth` |
| Booleans | `is`/`has`/`should` prefix | `isLoading` |
| CSS classes | `kebab-case` | `review-card` |
| Bundle files | plural | `utils.ts`, `constants.ts`, `types.ts` |
| Supporting files | suffixes | `.test.tsx`, `.stories.tsx`, `.module.css` |

**Component files:** either match content (`ReviewCard.tsx`, `useReviewRun.ts`) **or** kebab-case everything (`review-card.tsx`). kebab-case avoids conflicts on case-insensitive filesystems. Pick one, enforce with a linter. (Match the existing repo convention before introducing your own.)

## Anti-patterns

- Deep nesting (`components/features/dashboard/widgets/weather/small/index.tsx`) — cap at 3–4 levels.
- A `components/` folder with 200+ files and no subdivision.
- A 2000-line `utils.ts` "black hole".
- Hoisting component-local code to `src/`-level shared folders before it's actually reused.
- Relative-path spaghetti (`../../../`) instead of path aliases.
