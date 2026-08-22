---
name: frontend-architecture
description: >
  Code organization and architecture decisions for React 19 + Next.js 15 App Router (TypeScript).
  WHERE code lives, not HOW to write it. Covers: project folder structure, feature-based organization,
  component splitting rules, constants/utils/helpers/services placement, business logic separation,
  naming conventions, state colocation, and Next.js Server/Client Component boundary decisions.
  TRIGGER when: "where to put", "folder structure", "project structure", "how to organize",
  "where does X live", "code organization", "feature folder", "colocation", "business logic",
  "utils vs helpers", "constants", "component splitting", "Server Component or Client Component",
  "Server Action or Route Handler", "where do I place".
  Does NOT cover: React hooks API, component implementation style, Next.js caching/metadata features,
  state management APIs (use react-best-practices, next-best-practices, or typescript-expert for those).
---

# Frontend Architecture

> **WHERE code lives, not HOW to write it.**

This skill covers structural and organizational decisions for React 19 + Next.js 15 App Router projects. It answers "where does this go?" — not "how do I implement it?". For component patterns and hooks API, see `react-best-practices`. For Next.js feature usage (caching, metadata, image optimization), see `next-best-practices`.

## When to invoke this skill

- Setting up a new project or feature folder
- Deciding where to put a new component, hook, utility, or constant
- Choosing between Server Component and Client Component
- Choosing between Server Action and Route Handler
- Refactoring messy or unorganized code
- Debating feature-based vs type-based organization
- Unsure where business logic belongs

## Related skills

| Skill | What it covers (NOT this skill) |
|---|---|
| `react-best-practices` | Component APIs, hooks patterns, performance, anti-patterns |
| `next-best-practices` | RSC data fetching, caching, metadata, image optimization |
| `typescript-expert` | Type-level programming, generic patterns, type utilities |

## Reading paths

- **New project setup** → [folder-structure](rules/folder-structure.md) → [feature-organization](rules/feature-organization.md) → [naming-conventions](rules/naming-conventions.md)
- **"Where do I put this?"** → [component-splitting](rules/component-splitting.md) → [constants-utils](rules/constants-utils.md) → [business-logic](rules/business-logic.md)
- **Next.js decisions** → [nextjs-specifics](rules/nextjs-specifics.md) → [feature-organization](rules/feature-organization.md)
- **State confusion** → [state-placement](rules/state-placement.md) → [business-logic](rules/business-logic.md)
- **Naming question** → [naming-conventions](rules/naming-conventions.md)

---

## Quick Decision Trees

### Where does this component live?

```
Is it used in only one feature?
├── YES → put it inside features/<name>/components/
│         (or colocated in the route segment if Next.js page)
└── NO → Is it a generic UI primitive (Button, Modal, Input)?
         ├── YES → components/ui/
         └── NO (domain logic but shared) → components/ or shared/components/
```

### Where does this function/utility live?

```
Is it a pure function with no React dependency?
├── YES → Does it belong to one feature only?
│         ├── YES → features/<name>/utils.ts
│         └── NO (2+ features use it) → shared/utils/ or lib/
└── NO (uses React) → Is it a hook?
                      ├── YES → features/<name>/hooks/ or shared/hooks/
                      └── NO → rethink: move React logic out
```

### Where do constants live?

```
Used in one feature only?
├── YES → features/<name>/constants.ts (or colocated in the file that uses them)
└── NO → shared/constants/<domain>.constants.ts
```

### Server Component or Client Component?

```
Start with Server Component (default).
Add "use client" only if the component needs:
├── useState / useReducer
├── useEffect / useLayoutEffect
├── Browser APIs (window, document, localStorage)
├── Event handlers that trigger state changes
├── Third-party client-only libraries
└── Context consumers (that aren't server-compatible)

Rule: push "use client" as DEEP in the tree as possible.
```

### Server Action or Route Handler?

```
Who calls this endpoint?
├── Your own UI (forms, buttons) → Server Action in app/lib/actions.ts
└── External system / third-party / webhook → Route Handler (route.ts)
    Also Route Handler for:
    ├── Streaming responses
    ├── Large file uploads
    └── Public REST API
```

---

## Core Principles

1. **Colocation first** — keep code near where it's used; move to shared only when 2+ places need it
2. **Zero business logic in JSX** — components render, hooks/services compute
3. **Feature boundaries are real** — features don't import from each other directly
4. **Server by default** — in Next.js, default to Server Component; add `"use client"` last resort
5. **One source of truth for naming** — PascalCase components, camelCase utils, UPPER_SNAKE_CASE constants, kebab-case folders

---

## Rules Reference

| File | What it covers |
|---|---|
| [rules/folder-structure.md](rules/folder-structure.md) | Canonical directory tree, org strategies, src/ vs root |
| [rules/feature-organization.md](rules/feature-organization.md) | features/ dir anatomy, boundary rules, FSD overview |
| [rules/component-splitting.md](rules/component-splitting.md) | When to split, SRP test, composition patterns |
| [rules/constants-utils.md](rules/constants-utils.md) | constants.ts, utils/, helpers/, services/ — what goes where |
| [rules/business-logic.md](rules/business-logic.md) | 3-layer model, hooks, API layer, DTOs |
| [rules/naming-conventions.md](rules/naming-conventions.md) | File/folder/export naming rules |
| [rules/state-placement.md](rules/state-placement.md) | Colocation, lifting state, Zustand scoping |
| [rules/nextjs-specifics.md](rules/nextjs-specifics.md) | Server/Client boundary, Server Actions, Route Handlers, route groups |

## Sources

All 51 research URLs → [README.md](README.md)
