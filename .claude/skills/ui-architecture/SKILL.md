---
name: ui-architecture
description: "React/Next.js frontend architecture and code organization — where components, hooks, utils, constants, and business logic should live; feature vs. layer structure; colocation rules; naming conventions; barrel-file (index.ts) guidance. Use when deciding where a new file belongs, restructuring client/src/, or reviewing a PR for placement/organization issues. Does NOT cover component internals, hook correctness, or state patterns (see react-best-practices) or Next.js routing files (see next-best-practices)."
version: 1.1.0
metadata:
  tags: react, nextjs, architecture, folder-structure, code-organization, colocation, frontend
---

# UI Architecture & Code Organization

Where frontend code **lives**, not what it looks like once it's there. For sources, full scope, and how this differs from sibling skills, see [README.md](README.md). For before/after examples, see [examples.md](examples.md). For top-level layout and the promote/colocate call, see [folder-structure.md](folder-structure.md). For feature-folder anatomy and the barrel-file rule in detail, see [component-organization.md](component-organization.md). For App Router organization (not routing mechanics — that's `next-best-practices`), see [nextjs-organization.md](nextjs-organization.md).

## Scope guardrail

Confirm the question is about **placement**, not **implementation**, before applying this skill:

| Question | Skill |
|---|---|
| "Where should this component/hook/constant/util live?" | **ui-architecture** (this skill) |
| "Is this component/hook written correctly? Is this state pattern right?" | `react-best-practices` |
| "What does `page.tsx` / `layout.tsx` / route grouping do?" | `next-best-practices` |

## Core principle: colocation

Place code as close as possible to where it's used. Promote something to a shared location only once a **second, unrelated** feature needs it — not preemptively.

> "Things that change together should be located as close as reasonable." — Dan Abramov, via Kent C. Dodds ([source](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster))

Duplicating 3-5 lines across two features is cheaper than a shared module with one real caller and one speculative one.

## Decision tree: where does a new file go?

1. **Is it a Next.js special file** (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`)? → Not this skill — see `next-best-practices`.
2. **Does it belong to exactly one route and nothing else uses it?** → colocate inside that route segment (e.g. `app/<route>/_components/`), prefixed `_` to opt out of routing.
3. **Does it belong to one feature area used across routes?** → `client/src/components/<feature>/` — this repo's existing pattern (see `diff-viewer/` below).
4. **Is it a small piece used only within that feature** (subcomponent, helper, constant)? → colocate inside the feature folder. Do not promote to a global `lib/`/`components/` location until a second feature needs it.
5. **Is it a pure, framework-agnostic function** (no JSX, no hooks)? → `helpers.ts` local to the feature, or `client/src/lib/` if genuinely shared app-wide.
6. **Is it a fixed value/enum/option list** (no computation)? → `constants.ts` local to the feature, or a shared constants file in `client/src/lib/` if reused.
7. **Is it stateful or side-effectful logic** (data fetching, subscriptions, derived state) reused by one or more components? → a custom hook (`useX.ts`), colocated with the feature or in `client/src/lib/hooks/` if shared.
8. **Is it a Zod schema/type contract?** → `@devdigest/shared` (`server/src/vendor/shared/`) if it crosses client/server, else a feature-local `types.ts`.
9. **Importing something outside the current feature/route folder?** → use the `@/...` alias. Relative paths only for files inside the same folder — see [folder-structure.md](folder-structure.md).
10. **Support file (`constants.ts`/`helpers.ts`/`styles.ts`) shared by 2+ sibling `_components/` in the same route segment?** → the route segment's own root (e.g. `app/<route>/constants.ts`), not duplicated into each sibling. See [nextjs-organization.md](nextjs-organization.md).

## Feature folder anatomy

Model new multi-component features on the existing `client/src/components/diff-viewer/` structure:

```
diff-viewer/
├── index.ts              # public boundary — the ONLY thing outside code imports
├── constants.ts          # fixed values local to this feature
├── helpers.ts            # pure functions local to this feature
├── styles.ts
├── comments.ts
├── DiffViewer/
├── FileCard/
├── CodeLine/
├── CommentCard/
├── CommentThreadView/
├── InlineComposer/
└── OutdatedComments/
```

One folder per feature, PascalCase subfolders for subcomponents, lowercase purpose-named files (`constants.ts`, `helpers.ts`, `styles.ts`) for feature-local support code, one `index.ts` re-exporting only the public API.

## Business logic placement

- Components render. Hooks hold state, effects, and business logic. Pure functions transform data.
- If a component body does more than call a hook and render, extract the logic into a hook.
- Don't create a wrapper component whose only job is calling a hook and rendering `null`/children — call the hook directly where it's needed (this duplicates a rule in `react-best-practices`' Over-Engineering section; flag it from either skill).

## Constants & utils rules

- `constants.ts` — literal values, enums, option lists only. No computation, no imports beyond types.
- `helpers.ts`/`utils.ts` — pure functions, no React imports, no hooks. Must be unit-testable without rendering anything.
- Never mix constants and helpers in one file, and never dump unrelated functions into a catch-all `misc.ts`.

## Naming conventions

- Components: PascalCase file/folder matching the exported component name.
- Hooks: `useX.ts`, camelCase, one concern per hook, `use` prefix required.
- Support files: lowercase, purpose-named (`constants.ts`, `helpers.ts`, `types.ts`) — never generic (`utils2.ts`, `misc.ts`, `stuff.ts`).

## Barrel files (`index.ts`)

The rule is about **shape**, not depth — a one-line named re-export is fine at any level; a hub that re-exports everything (`export *`) is not, at any level. Full table and rationale in [component-organization.md](component-organization.md).

- **OK**: a single-line `export { X } from './X'` (or `export type`) per component folder, including nested subfolders (`CodeLine/index.ts`) — this is an import-path convention, not a re-export hub.
- **OK**: one feature-root `index.ts` re-exporting only that folder's public API (a handful of named exports) — this is a boundary.
- **NOT OK**: any `export *` file, a root `components/index.ts` re-exporting every component in the app, or a multi-level chain where a barrel re-exports another barrel's `export *`. These break tree-shaking and slow the dev server/HMR ([source](https://tkdodo.eu/blog/please-stop-using-barrel-files)).
- Never reach into a feature's internals from outside via a deep import path that bypasses its root `index.ts` — that path existing is what the boundary is for.

## Anti-patterns to flag in review

- A new shared `utils/` or `components/` file created for a single caller — should be colocated instead.
- Business logic (data transforms, fetch calls, derived calculations) written directly in a component body instead of a hook.
- A wrapper component created only to satisfy a folder convention, adding indirection with no behavior of its own.
- An `export *` barrel, a root `components/index.ts`, or a chain where one barrel re-exports another barrel's `export *`.
- Constants and helpers mixed in one file, or a catch-all `misc.ts`/`helpers.ts` with unrelated functions.
- A feature folder imported from outside via an internal file path instead of its `index.ts`.
