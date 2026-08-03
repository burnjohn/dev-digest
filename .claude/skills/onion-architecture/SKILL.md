---
name: onion-architecture
description: "Backend layering for server/ — the dependency rule (domain-model → domain-services → application-services → infrastructure), what each ring may import, and how Fastify/Drizzle/Zod/the DI container/external SDKs map onto it. Use when deciding which layer new backend code belongs in, wiring a route to a service, adding a repository, or reviewing a PR for a layering violation. Does NOT cover Fastify mechanics (see fastify-best-practices), query/schema shape (see drizzle-orm-patterns, postgresql-table-design), or contract shape (see zod)."
version: 1.0.0
metadata:
  tags: backend, architecture, onion, layering, ports-and-adapters, server, dependency-rule
---

# Onion Architecture (Backend)

The dependency rule for `server/src/`: where new backend code lives, and which imports are
banned from crossing which boundary. For sources and what's out of scope, see
[README.md](README.md). For before/after examples drawn from this repo, see
[examples.md](examples.md).

## Scope guardrail

Confirm the question is about **layering/dependency direction**, not tool mechanics, before
applying this skill:

| Question | Skill |
|---|---|
| "Which ring does this file belong in? May X import Y?" | **onion-architecture** (this skill) |
| "Is this route/plugin/hook written correctly?" | `fastify-best-practices` |
| "Is this query/schema right?" | `drizzle-orm-patterns`, `postgresql-table-design` |
| "How should this contract be shaped?" | `zod` |
| "Where does a frontend file go?" | `ui-architecture` |

## The dependency rule

> "All code can depend on layers more central, but code cannot depend on layers further out
> from the core. In other words, all coupling is toward the center." — Jeffrey Palermo,
> [The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)

Everything below is a consequence of this one rule. The database is not the center — it is
external, reached through an interface the center defines.

## The four rings

```
server/src/modules/<module>/
├── domain-model/          # entities, value objects, enums, invariants
├── domain-services/       # pure operations spanning >1 entity + PORT interfaces
├── application-services/  # use cases, transaction boundary, orchestration
└── infrastructure/
    ├── http/               # Fastify routes = driving adapters
    ├── persistence/        # Drizzle repositories = driven adapters
    └── external/           # module-local adapters (shared ones stay in src/adapters/)
```

| Ring | Contains | May import | Must never import |
|---|---|---|---|
| `domain-model` | Entities, value objects, enums, invariants | Nothing outside itself | `fastify`, `drizzle-orm`, `db/schema`, `db/rows.ts`, `node:*`, `platform/container` |
| `domain-services` | Pure cross-entity operations, **port interfaces** | `domain-model` | Same as above |
| `application-services` | Use cases, transaction boundary, orchestration | `domain-model`, `domain-services` (ports only) | Concrete infra classes, `fastify`, raw Drizzle query builders |
| `infrastructure` | Fastify routes, Drizzle repositories, SDK adapters | Everything | Nothing banned — this is the only ring allowed to import framework/driver packages |

Port interfaces are declared in `domain-services/ports.ts` and implemented in
`infrastructure/` — that inversion is what makes the ring order hold in a language with no
compiler-enforced module boundary.

## Mapping to today's files

The repo doesn't have these folders yet. Use this table to place a rule against the current
tree without renaming anything — the ring is defined by the file's **role**, and the import
bans apply either way:

| Today | Ring |
|---|---|
| `routes.ts` | `infrastructure/http` |
| `repository.ts`, `repository/*.repo.ts` | `infrastructure/persistence` |
| `service.ts`, `run-executor.ts` | `application-services` |
| `helpers.ts` (pure transforms), `constants.ts` | `domain-model` or `domain-services` |
| `platform/` (container, errors, jobs, SSE bus), `src/adapters/` | `infrastructure` (app-wide) |

New modules get the real folders (see `examples.md`). Existing modules keep their flat
filenames until touched — see Strangler rule below.

## Tool rules

**Fastify** (`fastify`, `fastify-type-provider-zod`, `@fastify/*`, `fastify-sse-v2`)
- A handler does three things: `getContext(container, req)`
  (`modules/_shared/context.ts`), call **one** application service, return the result.
  Anything else moves inward.
- `container.db` in a route handler is a hard error — it skips two rings.
- Zod schemas from `@devdigest/shared` are declared on the route; never
  `Schema.parse(req.body)` inside the handler body.
- Transport policy — rate-limit tiers, `config: { rateLimit: false }`, status codes — stays
  in `infrastructure/http`. Inner rings throw domain errors (`platform/errors.ts`); the
  error handler in `app.ts` maps them to HTTP.
- Fastify decorators are composition-root wiring. `app.decorate('container', …)` is the
  only one; don't decorate the app instance with domain objects.

**Drizzle** (`drizzle-orm`, `postgres`, `drizzle-kit`)
- `db/schema` is imported **only** from `infrastructure/persistence/`, `db/`, and
  migrations. Nowhere else.
- Row types from `server/src/db/rows.ts` never cross out of a repository — map to a domain
  type at the boundary. A `PullRow` in an application-service signature is a violation.
- **Transactions belong to `application-services`.** Repository methods take an optional
  transaction handle and fall back to the plain `db` connection when it's absent, so a use
  case can compose several repositories atomically (unit-of-work pattern — see
  [Atomic Repositories](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
  in README Sources).
- Query builders (`eq(...)`, `and(...)`, `.select()`) are never assembled outside a
  repository.

**Zod / `@devdigest/shared`**
- Contracts change in `@devdigest/shared` first, then consumers.
- Distinguish **DTO** (request/response envelope — belongs to `infrastructure/http`) from
  **domain type** (entity/value shape — may live in the inner rings). They are not the same
  type just because they look similar today.
- Parse once at the edge, pass the parsed type inward — "parse, don't validate."
- Ports live in `src/vendor/shared/adapters.ts` today; a module-specific port goes in that
  module's `domain-services/ports.ts` instead of being pushed into the shared vendored file.

**DI container** (`platform/container.ts`)
- The container is the composition root — it is infrastructure. An application service
  takes its dependencies as constructor parameters **typed by port interfaces**, not by
  `Container`.
- Repositories are resolved from the container, never `new`ed inside a service.

**External SDKs** (`octokit`, `simple-git`, `@anthropic-ai/sdk`, `openai`,
`@vscode/ripgrep`, `@ast-grep/napi`, `graphology`, `dependency-cruiser`)
- Every one of these is imported only under `src/adapters/`, behind a port. The existing
  `RepoIntel` facade (`modules/repo-intel/README.md`) is the reference implementation,
  including its explicit `degraded?: boolean` contract for partial failures.

**Logging** (pino via the Fastify logger)
- Inner rings return results and throw errors; they do not log. Logging is infrastructure.

**Vitest + testcontainers** — gives the existing `*.it.test.ts` filename split an
architectural meaning:
- `domain-model` / `domain-services` → pure hermetic tests, never `*.it.test.ts`.
- `application-services` → fake in-memory port implementations (extend
  `src/adapters/mocks.ts` / `ContainerOverrides`), still hermetic.
- `infrastructure/persistence` → `*.it.test.ts` with testcontainers Postgres.
- If a use-case test needs a real database to pass, a dependency is pointing the wrong way.

## Strangler rule

New modules comply with the four rings from the start. For an existing file, don't rewrite
the module — when you touch an endpoint in `pulls`, `polling`, `settings`, or `workspace`,
extract **that endpoint's** DB access into a repository and its logic into a service. Named
backlog, worst first: `modules/pulls/routes.ts`, `modules/settings/routes.ts` +
`modules/settings/feature-models.ts`, `modules/polling/routes.ts`,
`modules/workspace/routes.ts`.

`platform/jobs.ts` and `adapters/auth/local.ts` also touch `db/schema` directly — they
already live in `infrastructure`, so the ring is correct; the violation is bypassing the
owning module's repository instead of going through it. Same strangler treatment, lower
priority.

## Anti-patterns to flag in review

- `container.db` (or any raw Drizzle call) inside a route handler.
- A Drizzle row type (`PullRow`, `FindingRow`, …) in an application-service signature.
- `new XRepository(container.db)` constructed inside a service instead of injected.
- A service importing `fastify`, setting a status code, or building a response envelope.
- A port interface declared inside `infrastructure/` instead of `domain-services/ports.ts`.
- A multi-statement write across repositories with no shared transaction handle.
- An external SDK (`octokit`, `simple-git`, LLM SDKs, …) imported outside `src/adapters/`.
- A use-case test that only passes against a real Postgres instance.
- An entity with no behavior and every rule pushed into the service (anemic domain model).

## Out of scope

`fastify-best-practices` and `drizzle-orm-patterns` cover the mechanics inside each ring —
this skill only governs which ring code lives in and which way imports point.
`reviewer-core/` already follows this shape (its `LLMProvider` port is defined outside the
engine, in `@devdigest/shared`, and injected at the boundary) but is not governed by this
skill — it's referenced here as prior art, not as a target for these rules.
