---
name: onion-architecture
description: Guides backend module design around Onion/hexagonal layering — domain rules at the center, application services next, infrastructure (HTTP routes, Drizzle repositories, adapters) on the outside, dependencies pointing inward only. Covers server/ (Fastify modules — routes → service → repository, DI container, adapters/ as ports) and reviewer-core/ (pure domain core with one injected LLMProvider port). Trigger terms: "onion architecture", "hexagonal architecture", "layered architecture", "dependency rule", "ports and adapters", "where does this logic belong", "service layer", "repository pattern", new backend module scaffolding, reviewing server/src/modules/** or reviewer-core/src/**.
---

# Onion Architecture

## Overview

DevDigest's backend already leans this way without naming it: `reviewer-core/` is a
pure domain core with one injected port, and `server/` modules mostly follow
`routes.ts → service.ts → repository.ts`. This skill makes that convention explicit
and gives a checklist for keeping new or touched code on the correct side of the
dependency rule.

## When to Use

- Adding a new `server/src/modules/<name>/` feature module
- Deciding whether new logic belongs in `routes.ts`, `service.ts`, or `repository.ts`
- Adding a pure function or a new `LLMProvider`-style call in `reviewer-core/src/`
- Reviewing a PR that touches `server/src/modules/**`, `server/src/platform/**`,
  `server/src/adapters/**`, or `reviewer-core/src/**`
- Deciding whether a Zod contract needs a new variant or should extend an existing one

## The Dependency Rule

Every ring may depend on rings **inside** it. No ring may depend on a ring
**outside** it. In DevDigest terms:

```
        ┌─────────────────────────────────────────┐
        │  Infrastructure (outer ring)              │
        │  routes.ts · repository.ts · adapters/*   │
        │  ┌───────────────────────────────────┐   │
        │  │  Application / service             │   │
        │  │  service.ts · review/run.ts        │   │
        │  │  ┌─────────────────────────────┐   │   │
        │  │  │  Domain (center)             │   │   │
        │  │  │  prompt.ts · grounding.ts    │   │   │
        │  │  │  reduce.ts · pure rules      │   │   │
        │  │  └─────────────────────────────┘   │   │
        │  └───────────────────────────────────┘   │
        └─────────────────────────────────────────┘
              dependencies point inward only →
```

Checklist for any file you're writing or reviewing:

1. Does it import `drizzle-orm`, `db/schema`, `octokit`, `fs`, or a concrete adapter
   class (`OpenRouterProvider`, `GitHubClient` impl, etc.)? → It belongs in
   `repository.ts`/`repository/*.repo.ts` or `server/src/adapters/*`. It must not be
   imported by a domain/pure file, and business logic must not live there.
2. Does it orchestrate multiple repositories/adapters or hold business rules that
   don't need I/O directly? → It belongs in `service.ts` (server) or
   `reviewer-core/src/review/run.ts` (the one file allowed to call the injected
   `LLMProvider` port).
3. Is it pure — no network, no filesystem, no DB, deterministic given its inputs? →
   It belongs at the domain center: `reviewer-core/src/{prompt,grounding,reduce,output}.ts`
   style files, or a module's own pure rule functions.
4. Is it a Fastify route handler? → Parse/validate via Zod schema, call `service.ts`,
   map the result to an HTTP status. Nothing else.

See [references/layers-and-dependency-rule.md](references/layers-and-dependency-rule.md)
for the general Onion Architecture model this maps to, and how it relates to
Hexagonal and Clean Architecture.

## Quick Reference

| Layer | DevDigest examples | Allowed imports | Forbidden imports |
|---|---|---|---|
| Domain (center) | `reviewer-core/src/{prompt,grounding,review/reduce,output}.ts` | `@devdigest/shared` contracts, other pure domain code | `drizzle-orm`, `fs`, `net`/`http` clients, concrete adapters |
| Application/service | `server/src/modules/<name>/service.ts`, `reviewer-core/src/review/run.ts` | domain code, repository/port **interfaces**, DI container | constructing a concrete adapter class directly; raw Drizzle |
| Infrastructure (outer) | `routes.ts`, `repository.ts`/`repository/*.repo.ts`, `server/src/adapters/*`, `reviewer-core/src/llm/openrouter.ts` | service layer, domain layer, Drizzle, Fastify, external SDKs | — (this ring is where I/O concentrates) |

## Instructions

1. **New server module** — follow the `repos/`, `agents/`, `repo-intel/` recipe:
   `routes.ts` declares Zod schemas and delegates to `service.ts`; `service.ts` is
   constructed with `app.container` and holds the business rules; `repository.ts` is
   the *only* file issuing Drizzle queries for that module's tables. Cross-module DB
   access goes through `container.<x>Repo`, never by importing another module's
   `repository.ts` folder directly. Full recipe:
   [references/server-module-pattern.md](references/server-module-pattern.md).
2. **New reviewer-core logic** — keep it pure. I/O reaches the domain only through an
   injected port parameter (mirror `review/run.ts`'s `input.llm.completeStructured(...)`),
   never through a direct import of a concrete provider. Full recipe:
   [references/reviewer-core-purity.md](references/reviewer-core-purity.md).
3. **New or extended Zod contract** — put the base domain shape in `@devdigest/shared`
   first (per root `CLAUDE.md`), then build transport/DTO variants with `.extend()` or
   `.pick()`. Never hand-duplicate a contract's fields. Details:
   [references/zod-contracts-across-layers.md](references/zod-contracts-across-layers.md).
4. **Reviewing existing code** — check against
   [references/anti-patterns.md](references/anti-patterns.md) before approving.

## Known Exceptions

`server/src/modules/{pulls,polling,settings,workspace}/` currently skip the
service/repository split — their `routes.ts` files query Drizzle and hold business
logic directly. This is a **documented legacy exception**, not something to fix
opportunistically. Don't nag about these files as-is; do apply the full pattern to
*new* modules, and to these four only if they're already being substantially
rewritten for an unrelated reason.

## Best Practices

1. **Facades delegate, they don't re-declare.** If a module's `repository.ts` wraps
   sub-repositories (as in `reviews/repository.ts` + `repository/*.repo.ts`), it must
   import and delegate to their types/functions, never redefine them — see the
   duplication smell already flagged in `server/INSIGHTS.md` (2026-08-04).
2. **One port, one adapter.** Each external system (`GitClient`, `GitHubClient`,
   `LLMProvider`, `CodeIndex`, `SecretsProvider`, `AuthProvider`) is an interface in
   `@devdigest/shared`, wired to a concrete implementation only in
   `platform/container.ts`. Services depend on the interface via the container, never
   `new SomeConcreteAdapter()` directly.
3. **Vertical slice + onion, not flat layers.** DevDigest organizes by feature module
   (`server/src/modules/<name>/`), not by global `controllers/`/`services/`/`repositories/`
   folders. Apply the onion rings *within* each module — see
   [references/layers-and-dependency-rule.md](references/layers-and-dependency-rule.md#vertical-slices).
4. **Degrade, don't throw, at facade boundaries** where the existing convention already
   does so (e.g. `repo-intel`'s service returns empty/partial data when unindexed
   instead of failing callers).

## Constraints and Warnings

- This is a **guidance skill only** — there is no automated lint/CI gate enforcing
  these rules today (`dependency-cruiser` exists in `server/package.json` as a
  *product feature* for analyzing other people's repos, not for self-linting). Don't
  assume a build step will catch a violation; catch it in review.
- Don't fight the existing Zod-contract design by inventing a separate "domain model"
  type for things `@devdigest/shared` contracts already cover — extend, don't fork.
- Don't force a retroactive refactor of the four exempted modules as a side effect of
  an unrelated task.

## References

- [references/layers-and-dependency-rule.md](references/layers-and-dependency-rule.md) - The Onion Architecture model, its relation to Hexagonal/Clean Architecture, and how it combines with DevDigest's vertical-slice modules
- [references/server-module-pattern.md](references/server-module-pattern.md) - routes → service → repository → DI container, worked from `repos/`, `agents/`, `repo-intel/`
- [references/reviewer-core-purity.md](references/reviewer-core-purity.md) - The injected-port pattern, worked from `review/run.ts` and `llm/openrouter.ts`
- [references/zod-contracts-across-layers.md](references/zod-contracts-across-layers.md) - Base contract vs. `.extend()`/`.pick()` DTO variants
- [references/anti-patterns.md](references/anti-patterns.md) - Concrete smells to flag in review, each with a fix
