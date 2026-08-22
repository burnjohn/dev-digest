# References

All research sources used to build this skill. Organized by topic.

---

## Project / Folder Structure

| Source | URL | What it covers |
|---|---|---|
| Robin Wieruch — React Folder Structure | https://www.robinwieruch.de/react-folder-structure/ | 5-step progressive scaling guide, colocation, feature-based org. Annually updated, widely cited. |
| Netguru — React Project Structure | https://www.netguru.com/blog/react-project-structure | Type-based vs feature-based trade-offs, enterprise scale |
| DEV — Recommended Folder Structure 2025 | https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc | Annotated directory trees for small/mid/large projects |
| Medium — Enterprise Folder Structure 2025 | https://medium.com/@tejasvinavale1599/the-best-folder-structure-for-scalable-react-apps-in-2025-enterprise-recommended-4fa755b8f0c7 | Enterprise: core/features/layouts/router breakdown |
| Web Dev Simplified — Folder Structure | https://blog.webdevsimplified.com/2022-07/react-folder-structure/ | Beginner-to-advanced: flat → grouped-by-type → grouped-by-feature |
| JS in Plain English — Folder Structure | https://javascript.plainenglish.io/react-best-practices-for-folder-structure-system-design-architecture-8fc2f09e3fff | UI vs form vs feature components, shared utilities |

---

## Feature-Based / Domain-Based Organization

| Source | URL | What it covers |
|---|---|---|
| Bulletproof React — Project Structure | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md | THE reference (30k+ stars): features/ dir with collocated components/hooks/API/types/tests |
| Bulletproof React — Project Standards | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md | Coding standards companion doc |
| Medium — Feature-Based Folder Guide | https://ahmad2point0.medium.com/react-app-feature-based-folder-structure-guide-848ddc7447d5 | Feature folder construction, queries/mutations inside features/<name>/api/ |
| Feature-Sliced Design — Official Docs | https://feature-sliced.design/docs | Formal methodology: Layers → Slices → Segments with strict dependency rules |
| Medium — FSD in React + TypeScript | https://serhiikoziy.medium.com/feature-sliced-design-architecture-in-react-with-typescript-447dc5e6a411 | Practical FSD implementation in React + TypeScript |

---

## Component Splitting Rules

| Source | URL | What it covers |
|---|---|---|
| Medium — 6 Pillars of Component Architecture | https://medium.com/@abbas-roholamin/splitting-a-ui-into-components-in-react-six-pillars-of-component-architecture-04538e542ce5 | SRP, complexity, reuse, testability, readability, team ownership |
| DEV — SRP in React | https://dev.to/mikhaelesa/single-responsibility-principle-in-react-10oc | SRP applied: "if you say 'and', split it" |
| LogRocket — React Design Patterns | https://blog.logrocket.com/react-design-patterns/ | Container/presentational, compound, render props, HOCs, hooks patterns |
| patterns.dev — Compound Pattern | https://www.patterns.dev/react/compound-pattern/ | Compound component pattern with hooks |
| patterns.dev — Hooks Pattern | https://www.patterns.dev/react/hooks-pattern/ | Hooks pattern reference |
| patterns.dev — Render Props Pattern | https://www.patterns.dev/react/render-props-pattern/ | Render props pattern reference |
| Makers' Den — Component Composition | https://makersden.io/blog/guide-on-react-component-composition | Composition over inheritance, slot patterns, component API design |

---

## Business Logic Separation

| Source | URL | What it covers |
|---|---|---|
| profy.dev — React Architecture Series (index) | https://profy.dev/article/react-architecture-api-layer-and-fetch-functions | 8-part series overview: API client, fetch functions, DTOs, DI, business logic, domain logic, React Query |
| profy.dev — Part 1: API Client | https://profy.dev/article/react-architecture-api-client | Shared API client extraction |
| profy.dev — Part 5: DI | https://profy.dev/article/react-architecture-infrastructure-services-and-dependency-injection | Infrastructure services and dependency injection |
| profy.dev — Part 6: Business Logic | https://profy.dev/article/react-architecture-business-logic-and-dependency-injection | Business logic separation with DI |
| profy.dev — Part 7: Domain Logic | https://profy.dev/article/react-architecture-domain-logic | Domain logic layer |
| profy.dev — Part 8: TanStack Query | https://profy.dev/article/react-architecture-tanstack-query | React Query integration in architecture |
| Medium — Why Separate Business Logic | https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba | Motivation + before/after code examples |
| DhiWise — Separating UI and Logic | https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react | 3-layer model: presentational / business / implementation |
| Medium — Clean Architecture for React | https://osmancea.medium.com/clean-architecture-for-react-apps-c65e2d469418 | Clean Architecture layers mapped to React folders |
| Better Programming — Clean Architecture | https://betterprogramming.pub/clean-architecture-with-react-cc097a08b105 | Dependency inversion in React |
| DEV — Architecture Guide with Zustand + React Query | https://dev.to/neetigyachahar/architecture-guide-building-scalable-react-or-react-native-apps-with-zustand-react-query-1nn4 | Hooks for logic + React Query + Zustand layout |

---

## Custom Hooks Patterns

| Source | URL | What it covers |
|---|---|---|
| React Official Docs — Custom Hooks | https://react.dev/learn/reusing-logic-with-custom-hooks | OFFICIAL: when to extract, naming rules, composition, anti-patterns |
| fullstack.com — Production Hook Patterns | https://www.fullstack.com/labs/resources/blog/production-level-patterns-for-react-hooks | God hook anti-pattern, MVC-like hook decomposition |
| DEV — React Hooks Deep Dive | https://dev.to/a1guy/react-hooks-deep-dive-patterns-pitfalls-and-practical-hooks-424k | Stale closures, overuse pitfalls, practical patterns |

---

## State Management Organization

| Source | URL | What it covers |
|---|---|---|
| Kent C. Dodds — State Colocation | https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster | THE colocation article: push state down, only lift when necessary |
| Developer Way — State Management 2025 | https://www.developerway.com/posts/react-state-management-2025 | Decision framework: local → prop drilling → Context → Zustand/Jotai |
| TkDodo — Zustand and React Context | https://tkdodo.eu/blog/zustand-and-react-context | Scope Zustand stores via Context, avoid global singleton |
| Makers' Den — State Management 2025 | https://makersden.io/blog/react-state-management-in-2025 | Zustand vs Jotai vs XState with decision criteria |

---

## Naming Conventions, Constants & Utils

| Source | URL | What it covers |
|---|---|---|
| Business Compass — React Naming Conventions | https://knowledge.businesscompassllc.com/react-naming-conventions-and-coding-standards-best-practices-for-scalable-frontend-development/ | PascalCase components, camelCase hooks, UPPER_SNAKE_CASE constants, kebab-case files |
| Sufle — Naming Conventions in React | https://www.sufle.io/blog/naming-conventions-in-react | Components, utilities, constants, hooks, test files naming |
| Medium — File and Folder Naming | https://athulchandran-m.medium.com/10-secrets-for-mastering-file-and-folder-naming-conventions-in-react-projects-a29e3103197d | PascalCase vs kebab-case debate, barrel files, constants naming |

---

## TanStack Query / Data Fetching Architecture

| Source | URL | What it covers |
|---|---|---|
| TkDodo — Practical React Query (33-part series) | https://tkdodo.eu/blog/practical-react-query | Query keys, custom hooks per query, data transformation with select. Maintained by TanStack Query maintainer. |
| TanStack Query — TkDodo Blog Index | https://tanstack.com/query/v4/docs/framework/react/community/tkdodos-blog | Official index of all TkDodo posts |

---

## Next.js App Router — Official Documentation

| Source | URL | What it covers |
|---|---|---|
| Next.js — Project Structure | https://nextjs.org/docs/app/getting-started/project-structure | All folder/file conventions, special files, route groups, parallel routes, intercepting routes, 3 org strategies |
| Next.js — Server and Client Components | https://nextjs.org/docs/app/getting-started/server-and-client-components | When to use each, `"use client"` boundary semantics, module graph, composition patterns |
| Next.js — Fetching Data | https://nextjs.org/docs/app/getting-started/fetching-data | fetch in async Server Components, ORM/DB direct, parallel fetch, React.cache, Suspense streaming |
| Next.js — Mutating Data | https://nextjs.org/docs/app/getting-started/mutating-data | `'use server'` placement, Server Actions organization, revalidatePath, redirect |
| Next.js — Layouts and Pages | https://nextjs.org/docs/app/getting-started/layouts-and-pages | File-system routing, root layout, nested layouts, dynamic segments, PageProps/LayoutProps types |
| Next.js — Route Groups | https://nextjs.org/docs/app/api-reference/file-conventions/route-groups | `(folderName)` convention, 3 use cases, caveats |
| Next.js — Parallel Routes | https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes | `@folder` slot convention, default.js fallback, dashboards and modals |
| Next.js — Intercepting Routes | https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes | `(.)`, `(..)`, `(...)` conventions, modal pattern with parallel routes |
| Next.js — Route Handlers | https://nextjs.org/docs/app/api-reference/file-conventions/route | HTTP methods, NextRequest/NextResponse, CORS, webhooks, streaming |
| Next.js — Proxy (Middleware) | https://nextjs.org/docs/app/api-reference/file-conventions/proxy | ⚠️ Renamed from middleware.ts in Next.js 16; matcher config; auth caveats |
| Next.js — Colocation (older path) | https://nextjs.org/docs/app/building-your-application/routing/colocation | Colocation rules, 3 org strategies (widely linked reference) |

---

## Next.js App Router — Community Sources

| Source | URL | What it covers |
|---|---|---|
| Medium — Mastering Next.js App Router Structure | https://thiraphat-ps-dev.medium.com/mastering-next-js-app-router-best-practices-for-structuring-your-application-3f8cf0c76580 | Opinionated app/ structure, route groups in practice, server/client boundary heuristics |
| MakerKit — Next.js Server Actions Guide | https://makerkit.dev/blog/tutorials/nextjs-server-actions | Production SaaS patterns: dedicated actions files vs inline, mutation logic separation |
| Vercel GitHub — Server Action Placement | https://github.com/vercel/next.js/discussions/55908 | Community consensus: feature-colocated vs centralized actions, DB query vs action separation |
| Vercel GitHub — Server Actions vs Route Handlers | https://github.com/vercel/next.js/discussions/72919 | Decision tree: Actions=UI mutations, Handlers=public APIs/webhooks; Server Components=read |
