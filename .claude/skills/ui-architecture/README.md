# UI Architecture Skill

A skill for **where code belongs** in a React / Next.js codebase — component placement, feature-based folder structure, colocation, constants/utils/services/types boundaries, business-logic extraction, and Next.js App Router architecture. Deliberately scoped to **structure and organization**, not runtime correctness or performance — see [Scope & related skills](#scope--related-skills) below.

Working title during research: *"UI архітектура фронтенду"*.

## File Structure

```
ui-architecture/
├── SKILL.md                                  # Quick reference + decision table (loaded on trigger)
├── README.md                                 # This file — overview + full source list
├── examples.md                               # Before/after folder-tree migration example
└── references/
    ├── component-organization.md             # Feature-based vs type-based, bulletproof-react, FSD, composition
    ├── constants-utils-services.md            # Constants placement, utils vs services, business-logic extraction
    ├── types-organization.md                 # TypeScript types colocation gradient
    └── nextjs-app-router-architecture.md      # app/ boundaries, route groups, DAL, Server Actions placement
```

## Scope & Related Skills

This skill intentionally does **not** cover performance, memoization, hook-correctness rules, or Next.js caching/RSC-serialization details — those already live in this project's `react-best-practices` and `next-best-practices` skills, and duplicating them here would just create two sources of truth that can drift apart. If a question is "is this correct/fast," route to those skills; if it's "where should this live," this is the one.

## Sources

All sources gathered during research for this skill, grouped by topic. First-party/official docs are listed first in each group as the highest-confidence source; the rest are independent practitioner write-ups used to corroborate and fill in practical detail official docs don't cover.

### Official documentation

- [React Docs — Thinking in React](https://react.dev/learn/thinking-in-react) — official methodology for breaking UI into components and deciding where state lives.
- [React Docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — when/how to extract logic into hooks instead of duplicating it across components.
- [React Docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — official guidance on what does *not* belong in `useEffect`, relevant to keeping business logic in the right place.
- [Next.js Docs — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) — official overview of all App Router organizational conventions.
- [Next.js Docs — src Directory](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) — official convention for separating app code from root config.
- [Next.js Docs — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) — official `(group)` convention.
- [Next.js Docs — Colocation](https://nextjs.org/docs/app/building-your-application/routing/colocation) — official rules for safely colocating files inside `app/`, including private folders (`_folder`).
- [Next.js Docs — Server Actions and Mutations](https://nextjs.org/docs/13/app/building-your-application/data-fetching/server-actions-and-mutations) — official `'use server'` conventions.

### Architecture methodologies (feature-based / colocation)

- [bulletproof-react (alan2207, GitHub)](https://github.com/alan2207/bulletproof-react) — the most-cited production React architecture guide; `features/` + `shared`, unidirectional imports.
  - [docs/project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
  - [docs/project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)
- [Feature-Sliced Design — official docs](https://feature-sliced.design/) — formal layers/slices/segments methodology with a linter to enforce boundaries.
  - [Feature-Sliced Design (GitHub)](https://github.com/feature-sliced/documentation)
- [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) — practical, frequently-updated guide framing folder structure as a progression, not a one-time decision.
- [Wisp CMS — The Ultimate Guide to Organizing Your Next.js 15 Project Structure](https://www.wisp.blog/blog/the-ultimate-guide-to-organizing-your-nextjs-15-project-structure) — combining feature-based architecture with Next.js's `src/`/`app/` split.
- [MakerKit — Next.js 16 App Router Project Structure: The Definitive Guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure) — worked example of `src/{app,features,components,lib,types}`.

### Business logic / component vs. logic separation

- [Container/Presentational Pattern (Vitor Britto, Medium)](https://medium.com/@vitorbritto/react-design-patterns-the-container-presentational-pattern-775b91aa0c49) — classic smart/dumb component split.
- [Kent C. Dodds — Advanced React Patterns (GitHub)](https://github.com/kentcdodds/advanced-react-patterns) — compound components, composition over configuration.
- [Custom Hooks in React: Streamlining Business Logic (Siddarth Bulusu, Medium)](https://siddarth-bulusu.medium.com/custom-hooks-in-react-streamlining-business-logic-for-cleaner-code-af9425244098) — hooks as the business-logic layer.

### Constants

- [Semaphore — How To Organize Constants in a Dedicated Layer](https://semaphore.io/blog/constants-layer-javascript) — colocated vs. shared constants, split-by-topic convention.

### Utils / helpers / services

- [Lib vs Utils vs Services Folders (Ali Bey, Medium)](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f) — the distinction this skill's `utils`/`services`/`lib` guidance is based on.
- [Are utils a code smell? (dev.to)](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054) — cautionary counterpoint on `utils/` becoming a dumping ground.

### Types (TypeScript)

- [Wisp CMS — How to Organize Types in a React Project](https://www.wisp.blog/blog/how-to-organize-types-in-a-react-project) — inline → colocated → shared graduation rule for types.

### Next.js — Data Access Layer & Server Actions

- [Ayush Sharma — Understanding the Data Access Layer in Next.js](https://aysh.me/blogs/data-access-layer-nextjs) — DAL as the sole boundary to the database.
- [MD Samrose — Structuring Your Data Access Layer in Next.js](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866) — splitting the DAL by domain.
- [DigitalApplied — Next.js Server Actions in Production: 2026 Patterns](https://www.digitalapplied.com/blog/nextjs-server-actions-production-patterns-2026-guide) — Server Actions as thin wrappers around the DAL.
- [Shahin — Organizing Routes and Files in Next.js: Private Folders and Project Structure](https://shahin.page/article/nextjs-routing-private-folders-and-project-structure) — practical private-folder usage.

### Style guide (naming/conventions, general context)

- [Airbnb React/JSX Style Guide (GitHub)](https://github.com/airbnb/javascript/tree/master/react) — most widely adopted React/JSX community style guide; used as background context for naming conventions, not directly cited as a rule in this skill (naming/JSX style overlaps with `react-best-practices`).
