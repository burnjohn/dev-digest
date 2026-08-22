---
name: onion-architecture
description: "Onion / ports-and-adapters layering for the DevDigest backend (server/ + reviewer-core/). Use when adding or reviewing a backend module — placing routes/services/repositories/adapters, deciding where a DB query or an external SDK call (LLM, GitHub, git, ripgrep, ast-grep) may live, wiring DI in platform/container.ts, defining a new port in @devdigest/shared, or keeping reviewer-core pure. Enforces the dependency rule (imports point inward) and ships a dependency-cruiser gate. NOT for the client/ frontend (use frontend-architecture) or React code."
version: "1.0.0"
---

# Onion Architecture — DevDigest backend

The backend **already is** an onion / ports-and-adapters architecture; this skill names it,
maps it onto our files, and **forces** it with a `dependency-cruiser` gate. Use it whenever
you add or review code under `server/` or `reviewer-core/`.

For provenance and the full reading list, see [README.md](README.md).

## The one rule

**All imports point inward.** A file may depend on layers more central than itself; it may
never depend on a layer further out. Coupling is always toward the core. This is the
Dependency Inversion Principle: inner layers declare interfaces (ports); outer layers
implement them; the composition root wires them together.

```
        ┌─────────────────────────────────────────────┐
        │  Transport (Fastify routes, plugins)          │  ← outermost
        │   ┌─────────────────────────────────────┐     │
        │   │  Infrastructure / Adapters           │     │
        │   │   src/adapters/* · db/* · repository │     │
        │   │   ┌─────────────────────────────┐    │     │
        │   │   │  Application (services)      │    │     │
        │   │   │   modules/*/service.ts       │    │     │
        │   │   │   ┌─────────────────────┐    │    │     │
        │   │   │   │  Ports (interfaces) │    │    │     │
        │   │   │   │  @devdigest/shared  │    │    │     │
        │   │   │   │   ┌─────────────┐   │    │    │     │
        │   │   │   │   │  Core       │   │    │    │     │
        │   │   │   │   │ reviewer-   │   │    │    │     │
        │   │   │   │   │ core (pure) │   │    │    │     │
        │   │   │   │   └─────────────┘   │    │    │     │
        │   │   │   └─────────────────────┘    │    │     │
        │   │   └─────────────────────────────┘    │     │
        │   └─────────────────────────────────────┘     │
        │       composition root: platform/container.ts  │
        └─────────────────────────────────────────────┘
```

The composition root (`platform/container.ts`) sits across the rings: it is the **only**
place allowed to know both a port and its concrete adapter, because its job is to bind them.

## Layer map (where code lives)

Full table with allowed/forbidden imports per layer and real file references:
→ **[layer-map.md](layer-map.md)**. Summary:

| Layer | Path | May import | Must NOT import |
|-------|------|-----------|-----------------|
| Core | `reviewer-core/src/**` | itself, shared contract **types** | any I/O: `fastify`, `drizzle-orm`, `octokit`, `simple-git`, `postgres`, `src/adapters/**`, `db/**` |
| Ports | `@devdigest/shared` (`src/vendor/shared/**`) | other shared types | anything concrete |
| Application | `modules/*/service.ts`, `run-executor.ts` | ports, `container`, own `repository`/`helpers` | `src/adapters/**` (concrete SDKs) |
| Infrastructure | `src/adapters/**`, `db/**`, `modules/*/repository*.ts` | ports, drivers/SDKs, `db/schema` | `modules/**` (a feature) |
| Composition root | `platform/container.ts` | everything (binds ports↔adapters) | — |
| Transport | `modules/*/routes.ts` + plugins | own `service`, `_shared`, contracts | `src/adapters/**`, `db/schema` (go through the service) |

## Decision framework (placing a change)

Apply in order:

1. **Is it an external call** (HTTP, DB, git, an LLM, a CLI like ripgrep/ast-grep)? It belongs
   behind a **port** in `@devdigest/shared/adapters.ts`, implemented by an **adapter** in
   `src/adapters/<kind>/`. Never call an SDK from a service or a route.
2. **Is it a DB query?** It lives in `modules/<name>/repository.ts` (or `repository/*.repo.ts`),
   the only files allowed to touch `db/schema` + `drizzle-orm`. Repositories return domain
   rows, not leaked query builders.
3. **Is it business orchestration?** It lives in `modules/<name>/service.ts` (heavy run logic
   in `run-executor.ts`). The service depends on **interfaces** via `container`, never on a
   concrete adapter class.
4. **Is it HTTP wiring?** `modules/<name>/routes.ts` only: Zod schema (request validation +
   response serialization) → call the service → map the result. No logic, no DB, no SDK.
5. **Pure domain logic** (diff → prompt → grounded findings, scoring)? It lives in
   `reviewer-core` and stays pure — its only outside contact is the injected `LLMProvider`.
6. **Cross-module need?** Reach the other capability through `container.*` (e.g.
   `container.repoIntel.*`, `container.agentsRepo`), never by importing another
   `modules/<other>/` internal file.

## Adding a new external dependency (the canonical move)

1. **Define the port first** — an interface in `src/vendor/shared/adapters.ts` that speaks the
   application's language ("I need to post a review comment"), with **no** vendor name in it.
2. **Implement the adapter** in `src/adapters/<kind>/<impl>.ts` that wraps the SDK.
3. **Add a mock** in `src/adapters/mocks.ts` (tests inject it).
4. **Wire it in the container** (`platform/container.ts`) as a lazy getter; add a field to
   `ContainerOverrides` so tests can inject the mock.
5. Services consume `container.<port>` — they never see the SDK.

This is exactly how `LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`,
`AuthProvider`, and `SecretsProvider` already work.

## Enforcement (this is what makes the skill "force" the architecture)

The dependency rule is not a convention you remember — it is a `dependency-cruiser` gate.
`dependency-cruiser` is **already** a dependency of `server/`. The full config, npm scripts,
severity rationale, and the known-exception list live in → **[enforcement.md](enforcement.md)**.

Before claiming a backend change is done, run:

```bash
cd server && npm run depcruise        # add the script per enforcement.md
```

Validated against the real graph: **0 errors, 15 warnings** today. The gate exits non-zero only
on an `error`, so it is green now and blocks any *new* `error`. `warn`s are **known drift** the
skill is tracking down (a burn-down baseline), not new license to add more. Severities are a
**ratchet** — promote a `warn` rule to `error` once its backlog is cleared (see enforcement.md).

## Known, honest drift & exceptions (do not "fix" silently)

Encoded `pathNot` **exceptions** (legitimate, kept green):
- `modules/repo-intel/service.ts` imports adapters (`codeindex/extract`, `astgrep`) — repo-intel
  **is** the indexer subsystem; it behaves as infrastructure, reached only through the
  `container.repoIntel` facade.
- `src/adapters/depgraph` imports `modules/repo-intel/constants.js` — an infra→module edge;
  clean fix is relocating that constant.

Current `warn` **drift** (real violations to burn down, then promote the rule to `error`):
- **8** files touch `db/schema` outside a repository — the `routes.ts` of `polling`/`pulls`/
  `workspace`/`settings`, plus `reviews/run-executor`, `reviews/diff-loader`, `repos/helpers`,
  `settings/feature-models`.
- **2** cross-module edges — `pulls/routes.ts → reviews/helpers.ts` and
  `repos/service.ts → repo-intel/constants.ts`.
- circular deps — mostly via the DI root (`container ↔ service`) plus the genuine
  `agents/helpers ↔ agents/repository` cycle.
