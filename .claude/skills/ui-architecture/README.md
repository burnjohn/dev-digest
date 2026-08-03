# UI Architecture & Code Organization Skill

**Version 1.1.0**

## Skill focus

This skill governs **where frontend code lives** — folder/file structure, feature vs. layer organization, colocation rules, where business logic/constants/utils belong, naming conventions, and barrel-file (`index.ts`) usage. It targets `client/src/` in this repo (Next.js 15 App Router, React 19), but the principles are standard React/Next conventions, not project-specific inventions.

It deliberately does **not** cover what code looks like once it's placed correctly — that's `react-best-practices`.

## What it covers

- Feature vs. layer folder structure, and when to use each
- Colocation: what stays local to a feature vs. what gets promoted to a shared location, and when
- Where business logic belongs (component vs. hook vs. pure function vs. service)
- Where constants and utility functions belong, and how to name/split those files
- Naming conventions for components, hooks, and support files
- Barrel files (`index.ts`): the shape-based rule — single-line component re-exports are fine, `export *` hubs are not, regardless of nesting depth (see [component-organization.md](component-organization.md))
- A decision tree for "where does this new file go?" and an anti-pattern list for code review
- Top-level `client/src/` layout, the promotion threshold, and the `@/...` vs. relative import rule (see [folder-structure.md](folder-structure.md))
- App Router-specific organization: thin pages, `_components/` conventions, route-segment support files, route groups, `"use client"` placement (see [nextjs-organization.md](nextjs-organization.md)) — routing *mechanics* stay owned by `next-best-practices`

## What it does NOT cover

| Concern | Owning skill |
|---|---|
| Component purity, props limits, composition patterns, `useEffect`/memoization misuse, state colocation *within* a component, render factories, key props, accessibility, Tailwind conventions | [`react-best-practices`](../react-best-practices/SKILL.md) |
| Next.js special files (`page.tsx`, `layout.tsx`, `loading.tsx`, route groups, parallel/intercepting routes, middleware/proxy) | [`next-best-practices`](../next-best-practices/SKILL.md) |
| Component/hook testing strategy | [`react-testing-library`](../react-testing-library/SKILL.md) |

**Rule of thumb**: if the question is "where should this file/folder be?", it's this skill. If it's "is this component/hook/state pattern written correctly?", it's `react-best-practices`. If it's "what does this Next.js special file do?", it's `next-best-practices`.

There is a small, deliberate overlap with `react-best-practices`' "Over-Engineering" and "Code Organization" sections (e.g. "don't create a wrapper component that only calls a hook") — both skills state it because it's reachable from either a placement question or a component-design question. No other overlap is intended; if new content added here starts restating component-internals rules, move it to `react-best-practices` instead.

## When to use

- Deciding where a new component, hook, constant, or utility function should live
- Restructuring or refactoring `client/src/` folder layout
- Reviewing a PR for organization/placement issues (premature abstraction, wrong-location files, barrel-file sprawl)
- Setting conventions for a new feature area before writing its first component

## Sources

Research conducted 2026-08-02. Links kept for future updates to this skill.

### Official / canonical references
- [React docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [React docs — Thinking in React](https://react.dev/learn/thinking-in-react)

### Project / folder structure
- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — primary reference architecture (feature folders, shared `components/`/`hooks/`, strict import boundaries)
- [bulletproof-react — project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)
- [bulletproof-react — README](https://github.com/alan2207/bulletproof-react/blob/master/README.md)
- [Robin Wieruch — React Folder Structure Best Practices (2026)](https://www.robinwieruch.de/react-folder-structure/)
- [Tania Rascia — How to Structure and Organize a React Application](https://www.taniarascia.com/react-architecture-directory-structure/)
- [Feature-Sliced Design — official docs](https://feature-sliced.design/) — more formal layered methodology (app/pages/widgets/features/entities/shared) with strict unidirectional dependencies; heavier than what this skill prescribes but a useful reference if the project ever needs more rigor
- [Feature-Sliced Design — Building Scalable Systems with React Architecture](https://feature-sliced.design/blog/scalable-react-architecture)

### Business logic placement (component vs. hook)
- [Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/)
- [Kent C. Dodds — When to break up a component into multiple components](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components)
- [Kent C. Dodds — State Colocation will make your React app faster](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — origin of this skill's core colocation principle
- [patterns.dev — Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — still valid in 2025 sources, but modern consensus favors hooks over container *components* for the same separation

### Component splitting / composition
- [Developer Way — React components composition: how to get it right](https://www.developerway.com/posts/components-composition-how-to-get-it-right)

### Constants / utils organization
- [Muhammed Cuma — Organizing Your React Project: Best Practices for Folder and File Structure](https://muhammedcuma.medium.com/organizing-your-react-project-best-practices-for-folder-and-file-structure-a18fc664d34c)

### Naming conventions
- [Spencer Pauly — Best practices for naming hooks & props in React](https://www.spencerpauly.com/tech/react-naming-conventions-best-practices)

### Anti-patterns — barrel files
- [TkDodo — Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files)
- [jsdev.space — Howto Replace Barrel Files with Better Import Strategies](https://jsdev.space/howto/stop-using-barrel-files/)

### Framework-specific (Next.js App Router)
- [Sentry — Next.js directory organization best practices](https://sentry.io/answers/next-js-directory-organisation-best-practices/) — colocation inside route folders vs. root-level shared code
- [Next Colocation Template](https://next-colocation-template.vercel.app/)
- [Next.js docs — Project Organization and File Colocation](https://nextjs.org/docs/app/getting-started/project-structure) — private folders (`_folder`), route groups, and the colocation-safety guarantee (only `page.tsx`/`route.ts` are publicly addressable); routing mechanics from this source are owned by `next-best-practices`, organizational guidance by `nextjs-organization.md` in this skill

### Style guides / pattern catalogs (secondary — tone/format reference only)
- [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react)
- [patterns.dev](https://www.patterns.dev/) (Lydia Hallie & Addy Osmani)

## File structure

```
ui-architecture/
├── SKILL.md                  # Rules: scope guardrail, decision tree, naming, barrel-file shape rule
├── folder-structure.md       # Top-level client/src/ layout, layer vs. feature, promotion threshold, import-path rule
├── component-organization.md # Feature folder anatomy, growth stages, support-file trio, barrel-file table
├── nextjs-organization.md    # App Router organization: thin pages, _components/, route groups, "use client"
├── examples.md                # Before/after code and folder-tree examples
└── README.md                  # This file — scope, differentiation from other skills, sources
```

## Changelog

- **1.1.0** (2026-08-03) — Added `folder-structure.md`, `component-organization.md`, `nextjs-organization.md`. Corrected the barrel-file rule from a flat "nested = NOT OK" to a shape-based rule (single-line component re-exports OK at any depth, `export *` hubs not OK) after finding the skill's own model folder (`diff-viewer/`) violated the original rule.
- **1.0.0** (2026-08-02) — Initial version. Scope carved out from `react-best-practices`' thin "Code Organization" section into a dedicated skill.
