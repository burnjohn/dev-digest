# Onion Architecture for DevDigest backend: research and source catalog

Research date: 2026-08-08
Purpose: evidence base for the `onion-architecture` backend skill and a future user-facing README.

This document is the canonical source ledger. Preserve the source IDs and exact URLs when material is transferred into the skill's `references/` files or a README. The skill should distinguish architectural principles from repository-specific choices and version-sensitive tool guidance.

## Scope and evidence model

The research answers these questions:

- What does Onion Architecture require, and how does it relate to Hexagonal and Clean Architecture?
- Where should domain rules, use cases, ports, adapters, routes, repositories, schemas, constants, helpers, and composition live?
- How should Fastify, Zod, Drizzle, PostgreSQL, external SDKs, queues, jobs, and SSE fit the model?
- How should dependencies, transactions, runtime validation, tenant scope, and data mapping cross boundaries?
- How can strict rules be introduced without first rewriting every existing module?
- Which tests prove each boundary and its runtime wiring?

Sources are classified as:

- **A — primary architecture source:** the author/original publication of a named architecture or pattern;
- **B — official technology documentation:** normative behavior for a framework, language, database, or tool;
- **C — official or established secondary guidance:** practical synthesis that informs implementation but is not the definition of Onion Architecture.

No single source dictates a universal Node.js folder tree. The feature-local directory model in the design is a DevDigest decision derived from inward dependency direction, information hiding, existing feature modules, and incremental migration needs.

## Repository evidence

### Backend toolchain

| Concern | Current tool/evidence | Architectural role |
|---|---|---|
| HTTP server | Fastify `^5.2.0`, `server/package.json` | driving HTTP/SSE adapter and plugin composition |
| Language/runtime | Node.js 22+, TypeScript `^5.7.2`, ESM, strict + `noUncheckedIndexedAccess` | implementation language and compile-time boundary checks |
| Runtime contracts | Zod `^3.24.1`, `fastify-type-provider-zod@^4.0.2` | validation and serialization contracts at I/O boundaries |
| Persistence | Drizzle ORM `^0.38.3`, drizzle-kit `^0.30.1`, `postgres@^3.4.5` | outbound persistence adapter and migration tooling |
| Database | PostgreSQL with pgvector | outer storage system and integrity boundary |
| Tests | Vitest `^2.1.8`, Testcontainers `^10.16.0`, Fastify `inject()` | layered unit, adapter, integration, and wiring verification |
| External integrations | Octokit, OpenAI, Anthropic, simple-git, ast-grep, ripgrep/code index | outbound adapters behind application-owned ports |
| Background/concurrency | `p-queue`, buses/executors, polling and SSE flows | driving job adapters and outbound scheduling/event ports |
| Static enforcement | dependency-cruiser `^17.4.3` | blocking import-direction and cycle gate with a legacy baseline |
| Pure review engine | `reviewer-core` with injected `LLMProvider` | existing inner application/domain core example |

### Current boundary gaps

The repository is already organized by feature, but several imports and construction choices cross the intended onion:

- `server/src/modules/agents/service.ts`, `github-tokens/service.ts`, `repo-intel/service.ts`, `repos/service.ts`, and `reviews/service.ts` instantiate concrete repositories;
- `server/src/modules/polling/routes.ts`, `pulls/routes.ts`, `settings/routes.ts`, and `workspace/routes.ts` import Drizzle query helpers directly;
- several services accept `Container`, which exposes database and platform details beyond the capability each use case needs;
- external integrations are sometimes selected inside feature services rather than supplied through inner ports;
- route, service, repository, helper, and constant files are colocated, but the dependency direction is mostly conventional rather than mechanically enforced.

These findings support a **strict-incremental** approach: forbid new violations immediately, retain existing violations in a reviewed baseline, and reduce that baseline as affected flows are migrated.

## Research conclusions

### 1. Onion, Hexagonal, and Clean Architecture share the same central rule

Palermo's Onion Architecture puts the domain model at the center, defines infrastructure-facing interfaces inward, implements them outward, and points all coupling toward the center. Cockburn describes the same inside/outside asymmetry using ports and replaceable adapters. Martin's Clean Architecture states the dependency rule explicitly: source dependencies point inward, and inner code cannot name outer mechanisms.

The skill should therefore treat layer names as secondary. A folder named `domain` that imports Drizzle is not compliant; an ordinary TypeScript module that owns business policy and has no outward dependencies can be.

### 2. Use feature-local onions, not repository-wide horizontal buckets

The current codebase already has bounded feature areas under `server/src/modules`. Preserve that ownership and place `domain`, `application`, and `adapters` within a feature when its complexity warrants them. This keeps changes local and prevents a global `services/` or `repositories/` directory from becoming a coupling hub.

Small features should omit empty ceremonial layers. Enforce the import direction and responsibility, not a fixed number of files. DDD aggregates and value objects are useful for rich business behavior but are not a prerequisite for applying Onion Architecture to a simple use case.

### 3. Put ports beside their inner consumers

A port exists because an inner use case needs a capability. Define its interface in application/domain language and implement it in an outer adapter. Do not place the port in the infrastructure directory or derive it from the methods of an SDK or ORM.

Repository ports should model meaningful collections or persistence capabilities. A generic CRUD interface per table leaks storage shape and produces abstractions that add little beyond Drizzle. The inner contract should expose only the queries and commands required by its use cases.

### 4. Keep application orchestration distinct from domain policy

Application services/use cases coordinate work: load state, authorize an operation, call domain behavior, persist changes, publish events, and return a typed result. Domain policy should remain callable without Fastify, a container, a database, or an SDK.

When behavior spans several domain objects and is intrinsically domain logic, use a domain service. When the code sequences I/O or controls a business transaction, it belongs in the application use case.

### 5. Treat Fastify as a driving adapter

Fastify's plugin encapsulation is valuable for registration and lifecycle boundaries, but it is not a substitute for application boundaries. Route handlers should validate/serialize HTTP data, derive authenticated workspace context, invoke a use case, and map errors/results to transport semantics.

Fastify recommends JSON Schema validation/serialization and warns against database access during initial async validation. With `fastify-type-provider-zod`, Zod schemas can supply route types while remaining in the HTTP adapter. Response schemas protect against accidental field disclosure.

### 6. Put Zod at boundaries, not in the domain center

TypeScript types disappear at runtime, so unknown external values must be parsed. Zod belongs at HTTP, configuration, external API, event, and persisted-JSON boundaries. Domain code should receive parsed values and use domain types or constructors to enforce its own invariants.

Cross-package `@devdigest/shared` Zod schemas remain the canonical wire contracts. They should be mapped to inner types rather than reused as domain entities. The repository's multiple-Zod-instance insight also means error handling should not rely on `instanceof ZodError` across package boundaries.

### 7. Confine Drizzle and PostgreSQL to persistence adapters

Drizzle TypeScript schema files are the persistence source of truth, and its transactions provide the outer implementation of atomic work. Inner code should not import tables, SQL functions, inferred row types, or Drizzle transaction handles.

Map database rows to inner values in the adapter. Martin's dependency rule specifically warns against passing database rows across an inner boundary. PostgreSQL constraints remain valuable defense-in-depth for storage invariants; they complement rather than replace domain rules.

Application-owned transaction semantics can be represented by a transaction/unit-of-work port whose implementation invokes `db.transaction`. If several repositories must participate, the inner abstraction must still avoid exposing a Drizzle transaction type.

### 8. Make tenant ownership part of inner contracts

DevDigest's `workspaceId` is not merely HTTP context. Every tenant-owned use case and persistence operation should take it explicitly, including job, SSE, cancellation, trace, and polling flows. The persistence adapter must apply it in the database predicate, and tests should prove that another workspace cannot observe or mutate the resource.

PostgreSQL row-level security can be considered as defense-in-depth, but it does not remove the need for application authorization and scoped repository ports.

### 9. Keep composition separate from use

Fowler's dependency injection guidance separates configuration from the code that uses a service. `server/src/app.ts` should remain the primary composition root. A container can build the graph, but passing the full container into use cases turns it into a service locator and obscures dependencies.

Prefer narrow constructor injection for collaborators and ordinary arguments for request-specific values. Required constructor parameters let TypeScript find all wiring call sites during migration.

### 10. Model jobs, streams, and external tools as adapters too

HTTP is not the only driving adapter. Queue consumers, polling loops, schedulers, and event subscribers invoke application use cases. GitHub, LLM providers, Git, code-indexing tools, filesystems, clocks, queues, and event publishers are driven capabilities implemented outside the core.

SSE formatting and connection lifecycle belong to the transport adapter. Replay, cancellation, and workspace ownership rules that must hold across transports belong in application/domain contracts.

### 11. Test at each boundary and test the wiring

Pure domain tests need no mocks. Application tests should use small fakes that implement inner ports. Fastify adapter tests should use `app.inject()`. Drizzle behavior should be verified against PostgreSQL through Testcontainers and follow the repository's `*.it.test.ts` convention.

Tests of isolated layers do not prove runtime assembly. Critical paths need at least one wiring test that exercises route/job entrypoint through use case to adapter. This follows the repository's existing insight that contract tests alone can miss a broken `route → bus/service → executor → repository` chain.

### 12. Enforce strict rules with a reviewed legacy baseline

dependency-cruiser supports forbidden dependency rules, path matching, cycle detection, error severities, and known-violation baselines. The locally installed `dependency-cruiser@17.4.3` exposes `depcruise-baseline`, which writes `.dependency-cruiser-known-violations.json`.

The gate should always run the full strict rule set. Existing violations live in the baseline; new ones fail. The baseline is checked in, trends downward, and is never regenerated automatically in CI. This is stronger and more honest than weakening rules until all legacy code has migrated.

## Recommended target mapping

| Artifact | Default owner | Boundary rule |
|---|---|---|
| entity, value object, business policy, domain error | `modules/<feature>/domain/` | no framework, schema library, database, SDK, or container import |
| use-case input/output, application service | `modules/<feature>/application/use-cases/` | coordinates domain and ports; no transport or ORM type |
| persistence/external/event/clock port | `modules/<feature>/application/ports/` or domain when truly domain-owned | named for the inner need; narrow and technology-neutral |
| Fastify route/plugin, HTTP/SSE schemas and mapping | `modules/<feature>/adapters/http/` | converts transport values and calls one use case |
| Drizzle repository implementation and row mapper | `modules/<feature>/adapters/persistence/` | implements inner port; owns query, transaction, and row details |
| Octokit/LLM/Git/indexer adapter | `modules/<feature>/adapters/external/` | validates/maps vendor data; implements an inner port |
| queue/scheduler/consumer | `modules/<feature>/adapters/jobs/` | drives a use case; owns retry/process mechanics, not business policy |
| feature public API | `modules/<feature>/index.ts` | exports intentional use-case/contract surface, not private adapters |
| concrete wiring | `server/src/app.ts`, narrowly supported by `platform/` | creates adapters and injects them; contains no use-case policy |
| cross-package HTTP/event contract | new file under canonical `server/src/vendor/shared/` contract workflow | wire contract only; never substitute for a domain entity |
| pure review engine | `reviewer-core/` | remains independent; server supplies outer provider adapters |

## Canonical source catalog

### Architecture foundations

- **OA-01 · A — Jeffrey Palermo, “The Onion Architecture: part 1”**
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
  Use for the center domain model, inward coupling, inner repository interfaces, and outer infrastructure implementations.

- **OA-02 · A — Jeffrey Palermo, “The Onion Architecture: part 2”**
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/
  Use for controller-to-core interaction, IoC, and replacing infrastructure implementations without coupling the controller to them.

- **OA-03 · A — Jeffrey Palermo, “The Onion Architecture: part 3”**
  https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/
  Use for the four tenets: independent object model, inner interfaces/outer implementations, inward coupling, and an independently runnable core.

- **HA-01 · A — Alistair Cockburn, “Hexagonal Architecture”**
  https://alistair.cockburn.us/hexagonal-architecture
  Use for inside/outside asymmetry, purposeful ports, replaceable adapters, primary/driving versus secondary/driven adapters, and isolated testing.

- **CA-01 · A — Robert C. Martin, “The Clean Architecture”**
  https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
  Use for the dependency rule, use-case isolation, interface adapters, boundary DTOs, and the rule against passing database rows inward.

- **MS-01 · C — Microsoft, “Common web application architectures”**
  https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures
  Use as an official practical synthesis of Application Core interfaces, Infrastructure implementations, UI composition, and the composition root.

- **MS-02 · C — Microsoft, “Designing a DDD-oriented microservice”**
  https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice
  Use to distinguish the domain, application, and infrastructure responsibilities and to avoid forcing rich DDD onto simple CRUD scenarios.

- **MS-03 · C — Microsoft Azure Architecture Center, “Use tactical DDD to design microservices”**
  https://learn.microsoft.com/en-us/azure/architecture/microservices/model/tactical-domain-driven-design
  Use for application orchestration, domain services, aggregates, and transactional consistency boundaries when domain complexity warrants them.

- **AWS-01 · C — AWS Prescriptive Guidance, “Hexagonal architecture pattern”**
  https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html
  Use for a technology-neutral ports-and-adapters implementation summary and testability guidance.

### Dependency injection, repositories, and transactions

- **FOW-01 · A — Martin Fowler, “Inversion of Control Containers and the Dependency Injection pattern”**
  https://martinfowler.com/articles/injection.html
  Use for separating configuration from use, constructor injection, and a distinct assembler/composition root.

- **FOW-02 · A — Martin Fowler, “Repository”**
  https://martinfowler.com/eaaCatalog/repository.html
  Use for collection-like domain-facing persistence mediation and one-way dependency through a repository interface.

- **FOW-03 · A — Martin Fowler, “Unit of Work”**
  https://martinfowler.com/eaaCatalog/unitOfWork.html
  Use for coordinating writes and concurrency across one business transaction.

### Fastify and Zod boundaries

- **FST-01 · B — Fastify 5.2, “Plugins”**
  https://fastify.dev/docs/v5.2.x/Reference/Plugins/
  Use for plugin registration, scoped encapsulation, and application assembly.

- **FST-02 · B — Fastify 5.2, “Encapsulation”**
  https://fastify.dev/docs/v5.2.x/Reference/Encapsulation/
  Use for plugin context boundaries and the encapsulation dependency graph.

- **FST-03 · B — Fastify 5.2, “Validation and Serialization”**
  https://fastify.dev/docs/v5.2.x/Reference/Validation-and-Serialization/
  Use for request/response schema boundaries, disclosure-safe serialization, and the warning against database work in initial async validation.

- **FST-04 · B — Fastify 5.2, “Testing”**
  https://fastify.dev/docs/v5.2.x/Guides/Testing/
  Use for `app.inject()` and testing fully booted plugin graphs.

- **FST-05 · B — Fastify, “Type Providers”**
  https://fastify.dev/docs/latest/Reference/Type-Providers/
  Use for schema-derived request and response typing; re-check version-sensitive details before implementation.

- **FZ-01 · B — `fastify-type-provider-zod` official repository**
  https://github.com/turkerdev/fastify-type-provider-zod
  Use for Zod validator/serializer integration and the compatibility table showing `<=4.x` for Zod 3, matching DevDigest's current versions.

- **ZOD-01 · B — Zod 3 documentation**
  https://v3.zod.dev/
  Use for the repository's installed major version and boundary parsing patterns.

- **ZOD-02 · B — Zod basic usage**
  https://zod.dev/basics
  Use for `parse`, `safeParse`, inferred input/output types, and a current conceptual overview; verify examples against Zod 3 before copying them.

- **ZOD-03 · B — Zod v3.24.1 source tag**
  https://github.com/colinhacks/zod/tree/v3.24.1
  Use as the exact-version reference when current Zod documentation has moved to a newer major.

### Drizzle ORM and PostgreSQL

- **DRZ-01 · B — Drizzle ORM, “SQL schema declaration”**
  https://orm.drizzle.team/docs/sql-schema-declaration
  Use for TypeScript schema ownership, exported models, and supported multi-file organization.

- **DRZ-02 · B — Drizzle ORM, “Transactions”**
  https://orm.drizzle.team/docs/transactions
  Use for implementing application-owned transaction semantics in the persistence adapter.

- **DRZ-03 · B — Drizzle ORM, “Migrations”**
  https://orm.drizzle.team/docs/migrations
  Use for the generate/apply migration workflow; DevDigest migrations remain generated rather than hand-edited.

- **PG-01 · B — PostgreSQL 16, “Constraints”**
  https://www.postgresql.org/docs/16/ddl-constraints.html
  Use for database-enforced integrity as a persistence-layer complement to domain invariants.

- **PG-02 · B — PostgreSQL, “Transaction Isolation”**
  https://www.postgresql.org/docs/16/transaction-iso.html
  Use when a use case's consistency guarantees depend on PostgreSQL isolation behavior.

- **PG-03 · B — PostgreSQL, “Row Security Policies”**
  https://www.postgresql.org/docs/16/ddl-rowsecurity.html
  Use for optional tenant defense-in-depth, not as a replacement for application authorization or scoped port methods.

### TypeScript and automated architecture enforcement

- **TS-01 · B — TypeScript, “Modules: Reference”**
  https://www.typescriptlang.org/docs/handbook/modules/reference
  Use for import resolution, type-only imports, and understanding what the compiler can and cannot enforce about the module graph.

- **TS-02 · B — TypeScript, “Project References”**
  https://www.typescriptlang.org/docs/handbook/project-references
  Use as optional background for stronger compile-time separation. Do not replatform this non-workspace repository solely to adopt project references.

- **DC-01 · B — dependency-cruiser official repository**
  https://github.com/sverweij/dependency-cruiser
  Use for configuring and running dependency graph validation.

- **DC-02 · B — dependency-cruiser rules reference**
  https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
  Use for forbidden/allowed/required rules, severity behavior, path matching, type-only dependencies, reachability, and cycles.

- **DC-03 · B — dependency-cruiser rules tutorial**
  https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-tutorial.md
  Use for converting the target layer model into maintainable rules.

Local version evidence: `server/node_modules/.bin/depcruise-baseline --help` under `dependency-cruiser@17.4.3` documents the baseline alias and `.dependency-cruiser-known-violations.json` output. This command output is repository evidence rather than a web source.

### Testing

- **VIT-01 · B — Vitest, “Mocking”**
  https://vitest.dev/guide/mocking
  Use for focused test doubles at port boundaries and cleanup semantics; verify APIs against the repository's Vitest 2 version.

- **VIT-02 · B — Vitest, “Testing in practice”**
  https://vitest.dev/guide/learn/testing-in-practice
  Use for preferring real, fast implementations and mocking dependencies rather than the unit under test.

- **TC-01 · B — Testcontainers for Node.js, “PostgreSQL”**
  https://node.testcontainers.org/modules/postgresql/
  Use for real PostgreSQL persistence-adapter integration tests.

Fastify adapter testing is covered by **FST-04**.

## Version and interpretation cautions

- Palermo, Cockburn, Martin, and Fowler describe stable architectural principles but use examples from other languages. Transfer the dependency relationships, not their framework-specific folder names.
- Fastify links are pinned to 5.2 where an archived version is available. Check the resolved server version before copying a current-doc API.
- DevDigest uses Zod 3 and `fastify-type-provider-zod` 4. Current Zod and integration docs may default to newer majors.
- DevDigest uses Vitest 2; current Vitest documentation may describe later APIs. The test-boundary guidance is stable, but exact helper APIs require local verification.
- Drizzle documentation evolves quickly. Use official docs plus local installed types and integration tests for transaction and inference details.
- PostgreSQL documentation must match the deployed major for behavior-sensitive details such as isolation or row security.
- TypeScript project references are optional background, not a requirement. DevDigest is explicitly not a monorepo workspace and already uses path aliases.
- Onion Architecture is a dependency architecture. DDD tactical modeling is compatible with it but not mandatory for every module.
- A strict dependency baseline is temporary debt inventory. It must never be treated as architectural permission or regenerated automatically to make CI green.

## Material to retain for a future README

A future README should reuse, with source IDs intact:

1. the inward dependency diagram;
2. the feature-local target tree and placement table;
3. the Fastify/Zod/Drizzle mapping;
4. a thin route → use case → port → adapter example;
5. transaction and `workspaceId` rules;
6. the test matrix;
7. the strict-incremental baseline policy;
8. the architecture-foundation and tool-specific source catalog above.

Do not copy every research paragraph into `SKILL.md`. Keep this ledger comprehensive, put task-specific detail in skill references, and keep the skill entry point short enough to load routinely.
