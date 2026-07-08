# frontend-architecture

> Skill for React/Next.js frontend architecture: where code lives, how projects are structured, how features are organized, and where business logic belongs.

**Version:** 1.0.0  
**Last updated:** 2026-06-28

---

## Purpose

This skill answers the question **"where does this code belong and why?"**

It covers structural and architectural decisions — not implementation details. When you need to decide whether a function goes in `utils/`, a `services/` file, or a custom hook; whether two features should share a folder or remain separate; or which architectural pattern fits your team's size and project complexity — this skill provides the guidance.

---

## Scope

### What This Skill Covers

- **Architectural patterns:** Feature-Sliced Design (FSD), Feature-Based Architecture (Bulletproof React), Clean Architecture (frontend adaptation), Layered Architecture — with comparison and decision guide
- **Project structure:** Canonical folder trees for small, medium, and large projects; `src/` vs root convention; state file placement
- **Feature organization:** Internal feature structure, public API pattern (`index.ts`), barrel file rules, cross-feature communication, promotion rule
- **Business logic placement:** 4-level model (pure functions / hooks / services / components), services layer, API layer, dependency injection for testability
- **Next.js integration:** FSD + App Router, `src/` pattern, thin routing wrappers, Server Actions in FSD structure
- **Module enforcement:** Steiger, Sheriff, ESLint module boundary rules
- **Architecture anti-patterns:** With symptom recognition, root cause, and fix

### What This Skill Does NOT Cover

| Topic | Where to find it |
|---|---|
| How to write React components (compound, HOC, render props) | `react-best-practices` |
| Custom hooks rules and anti-patterns | `react-best-practices` |
| Which state management library to choose | `react-best-practices` |
| Next.js routing file conventions (layout.tsx, page.tsx, loading.tsx) | `next-best-practices` |
| Server/Client component boundaries and RSC patterns | `next-best-practices` |
| Next.js caching APIs and Server Actions implementation | `next-best-practices` |
| Testing strategy and React Testing Library usage | `react-testing-library` |
| Zod schema definition and validation | `zod` |
| TypeScript advanced type patterns | `typescript-expert` |
| Database schema design | `drizzle-orm-patterns` |

---

## Typical Use Cases

```
"Which architecture should I use for this project?"
"How should I organize a new feature?"
"Where should this business logic live — hook, service, or utils?"
"Can feature A import from feature B?"
"What belongs in shared/ vs in a feature folder?"
"How do I set up path aliases?"
"What is the promotion rule and when does it apply?"
"How do I integrate FSD with Next.js App Router?"
"Where do Server Actions live in a FSD project?"
"Is this barrel file pattern correct?"
"How do I enforce module boundaries?"
"What is wrong with this folder structure?"
```

---

## Relationship to Other Skills

### Skill Responsibility Map

```
react-best-practices     →  HOW to write React code
next-best-practices      →  HOW to use Next.js features
frontend-architecture    →  WHERE code lives and WHY
react-testing-library    →  HOW to test React code
```

The boundary is **structure decisions** (this skill) vs **implementation decisions** (other skills).

### Differences from `react-best-practices`

`react-best-practices` covers:
- Component design rules (purity, max props, max lines)
- Composition patterns (compound components, render props, HOC)
- Hook rules (useEffect, useMemo, useCallback)
- State management library selection
- React anti-patterns (render factories, index as key, `&&` with 0)
- Code organization at the file level (import order, file quality)

`frontend-architecture` covers:
- Where components live in the project structure
- How features are bounded and what they expose
- Where business logic belongs across the project
- Cross-feature communication rules
- Which architectural pattern to choose and why

**Example boundary:** `react-best-practices` says "business logic goes in hooks/helpers, not in component bodies." `frontend-architecture` says "hooks live in `features/[x]/hooks/`, service functions live in `features/[x]/services/`, and pure utilities live in `shared/lib/`."

### Differences from `next-best-practices`

`next-best-practices` covers:
- App Router file conventions (layout, page, loading, error, not-found, route)
- Server vs Client component rules and RSC boundaries
- Async params/searchParams changes (Next.js 15+)
- Caching strategies (`use cache`, `unstable_cache`, revalidation)
- Server Actions implementation (useActionState, redirect gotchas)
- Route Handlers (when to use, when not to)
- Middleware patterns
- Image, font, script optimization
- Hydration errors

`frontend-architecture` covers:
- How to organize the `app/` directory at an architectural level
- Where FSD layers live relative to Next.js routing
- Which folder Server Actions belong in (FSD perspective)
- How to keep `app/` as a thin routing layer and architecture in `src/`

**Example boundary:** `next-best-practices` explains how `redirect()` works and why it must be outside try/catch. `frontend-architecture` explains that Server Actions belong in `features/[x]/api/` and are thin wrappers imported by the routing layer.

### Differences from `vercel-react-best-practices`

`vercel-react-best-practices` (if installed) covers:
- Vercel platform-specific deployment patterns
- Edge Runtime optimization
- Vercel Data Cache and CDN behavior
- Performance optimization for Vercel infrastructure
- ISR and on-demand revalidation on Vercel
- Vercel-specific environment variable handling

`frontend-architecture` is infrastructure-agnostic — it applies equally whether deploying to Vercel, AWS, or a self-hosted server. The architectural patterns (FSD, Feature-Based, Clean Architecture) are independent of deployment target.

---

## Reference Files

| File | Primary question answered |
|---|---|
| `references/architecture-patterns.md` | Which architectural pattern fits my project? |
| `references/project-structure.md` | What should my folder structure look like? |
| `references/feature-organization.md` | How should I organize this feature internally? |
| `references/business-logic-placement.md` | Where does this piece of logic belong? |
| `references/nextjs-integration.md` | How do I use this architecture with Next.js App Router? |
| `references/anti-patterns.md` | Is there an architectural problem in this code? |

---

## Source Catalog

All recommendations in this skill are based on the following authoritative sources.

### Official Documentation

| Source | URL | Covers in this skill |
|---|---|---|
| Feature-Sliced Design — Overview | https://feature-sliced.design/docs/get-started/overview | FSD layers, slices, segments, cross-layer rules |
| Feature-Sliced Design — Next.js App Router Guide | https://feature-sliced.design/blog/nextjs-app-router-guide | FSD + App Router integration, src/ pattern |
| Feature-Sliced Design — Usage with Next.js | https://feature-sliced.design/docs/guides/tech/with-nextjs | Routing wrappers, middleware placement |
| Feature-Sliced Design — Migration Guide | https://feature-sliced.design/docs/guides/migration/from-custom | Incremental FSD adoption |
| Steiger (FSD linter) | https://github.com/feature-sliced/steiger | FSD rule enforcement, cross-layer violation detection |
| Next.js — Project Structure | https://nextjs.org/docs/app/getting-started/project-structure | Official Next.js project organization options |
| Next.js — src/ folder convention | https://nextjs.org/docs/app/api-reference/file-conventions/src-folder | src/ directory support in Next.js |
| Sheriff (module boundaries) | https://sheriff.softarc.io/docs/introduction | TypeScript module boundary enforcement |

### Expert Practitioners

| Source | Author | URL | Covers in this skill |
|---|---|---|---|
| Delightful React File/Directory Structure | Josh W. Comeau | https://www.joshwcomeau.com/react/file-structure/ | Small project structure, utils vs helpers, barrel file trade-offs |
| React Folder Structure Best Practices | Robin Wieruch | https://www.robinwieruch.de/react-folder-structure/ | 8-stage evolution model, incremental progression |
| Feature-Based React Architecture | Robin Wieruch | https://www.robinwieruch.de/react-feature-architecture/ | Feature folders, cross-feature communication |
| Clean Architecture on Frontend | Alex Bespoyasov | https://bespoyasov.me/blog/clean-architecture-on-frontend/ | Clean Architecture layers, dependency rule, domain separation |
| Does DDD Belong on the Frontend? | Khalil Stemmler | https://khalilstemmler.com/articles/typescript-domain-driven-design/ddd-frontend/ | Domain models, value objects, bounded contexts for frontend |
| DDD vs Clean Architecture | Khalil Stemmler | https://khalilstemmler.com/articles/software-design-architecture/domain-driven-design-vs-clean-architecture/ | Terminology mapping, when to apply each |
| Separate API Layers in React Apps | profy.dev | https://profy.dev/article/react-architecture-api-layer | API layer pattern, one function per endpoint |
| Business Logic and Dependency Injection | profy.dev | https://profy.dev/article/react-architecture-business-logic-and-dependency-injection | Services layer, DI for testability |
| React Hooks — Separation of Concerns | Felix Gerschau | https://felixgerschau.com/react-hooks-separation-of-concerns/ | Business logic separation, testability rule |
| The Wrong Abstraction | Sandi Metz | https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction | Promotion rule, premature extraction anti-pattern |
| Rearchitecting Airbnb's Frontend | Adam Neary (Airbnb) | https://medium.com/airbnb-engineering/rearchitecting-airbnbs-frontend-5e213efc24d2 | Large-scale architecture lessons, modular decomposition |

### Community Standards and Reference Implementations

| Source | Author | URL | Covers in this skill |
|---|---|---|---|
| Bulletproof React | alan2207 | https://github.com/alan2207/bulletproof-react | Feature-Based Architecture reference implementation |
| Bulletproof React — Project Structure | alan2207 | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md | Canonical feature folder structure, internal organization |
| FSD — Frontend Architecture Guide | FSD Team | https://feature-sliced.design/blog/frontend-architecture-guide | Comparison of 5 architectural approaches |
| FSD vs Clean Architecture | Phil Rich | https://philrich.dev/fsd-vs-clean-architecture/ | Direct comparison, trade-offs |
| Clean Architecture vs FSD in Next.js | Metastability | https://medium.com/@metastability/clean-architecture-vs-feature-sliced-design-in-next-js-applications-04df25e62690 | Practical comparison in Next.js context |
| Micro-Frontends: Are They Still Worth It? | FSD Team | https://feature-sliced.design/blog/micro-frontend-architecture | MFE vs modular monolith trade-offs |
| Screaming Architecture: React Folder Evolution | profy.dev | https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25 | Domain-driven folder naming, evolution stages |
| Frontend Architecture Patterns | Udara Senarath | https://medium.com/@udarasenarath/frontend-architecture-patterns-a-practical-guide-to-structuring-react-applications-that-scale-9af2701a6f0f | Pattern comparison, decision matrix |

### Enforcement Tooling

| Tool | URL | Purpose |
|---|---|---|
| Steiger | https://github.com/feature-sliced/steiger | FSD-specific linting (cross-layer imports, public API violations) |
| Sheriff | https://github.com/softarc-consulting/sheriff | General TypeScript module boundary enforcement |
| eslint-plugin-boundaries | https://github.com/javierbrea/eslint-plugin-boundaries | ESLint-based module boundary rules |
| eslint-plugin-fsd-lint | https://github.com/effozen/eslint-plugin-fsd-lint | ESLint plugin specifically for FSD rules |

---

## Changelog

### 1.0.0 — 2026-06-28
- Initial release
- Covers: FSD, Feature-Based, Clean Architecture, Layered Architecture
- 6 reference files: architecture-patterns, project-structure, feature-organization, business-logic-placement, nextjs-integration, anti-patterns
- Sources: 25 authoritative references (official docs, expert practitioners, community standards)
