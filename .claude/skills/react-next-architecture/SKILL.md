---
name: react-next-architecture
description: Use when designing, reviewing, or refactoring React or Next.js App Router architecture, including component and folder placement, feature boundaries, constants, helpers, business logic, state ownership, Server/Client Components, DALs, Server Actions, Route Handlers, routing, or architecture findings.
---

# React + Next.js Architecture

## Core principle

Organize by semantic ownership and explicit module/data boundaries. Colocate first, promote only after the shared contract is stable, and treat `app/` as the Next.js route/composition layer. Do not turn performance advice or numeric size limits into architecture rules.

For architecture decisions, this skill supersedes older local guidance that requires all fetching in hooks, JSON-only RSC props, or fixed component line/prop limits.

## Required setup

1. Read the nearest `AGENTS.md` and package `INSIGHTS.md`.
2. Inspect the existing route/feature and its imports before proposing a structure.
3. Resolve React and Next.js versions from the lockfile; do not infer version-sensitive behavior from memory.

## Load references by task

| Task | Required reference |
|---|---|
| Any placement, extraction, constants/helpers, feature/shared, or import-boundary decision | [placement-and-boundaries.md](references/placement-and-boundaries.md) |
| Components, hooks, Effects, reducers, context, URL state, composition, or client-heavy migration | [components-and-state.md](references/components-and-state.md) |
| Next.js routes, layouts, special files, route groups, parallel/intercepting routes, middleware/proxy, or version migration | [next-app-router.md](references/next-app-router.md) |
| RSC serialization, `'use client'`, DAL/DTO, fetching, Server Actions, Route Handlers, auth, caching, SSE, or polling | [server-client-and-data.md](references/server-client-and-data.md) |
| Architecture implementation or review | [review-checklist.md](references/review-checklist.md) |
| Citations, source verification, or updating this skill | [source-catalog.md](references/source-catalog.md) |

Load every reference whose trigger matches; do not load unrelated references.

## Decision order

1. Name the narrowest owner: route, feature, entity, shared capability, or server infrastructure.
2. Map the Server/Client module graph and protect privileged imports.
3. Choose the data boundary by caller: direct server read, Server Action, Route Handler, or client stream/query.
4. Put state and business rules in the smallest correct system.
5. Make high-value dependency rules enforceable through imports, schemas, or tests.

## Output contract

For implementation, change the smallest stable seam and preserve documented exceptions. For review, cite file/line evidence, the violated boundary, concrete impact, and the smallest responsibility-correct fix. Distinguish correctness risks from valid trade-offs and team preferences.

Keep performance outside scope unless caching changes freshness, invalidation, rendering semantics, or version correctness.
