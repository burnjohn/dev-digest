# Source catalog

This skill-local catalog copies the 35 source IDs, authority classes, definitions, exact URLs, and one-line purposes from the [canonical research ledger](../../../../docs/research/onion-architecture-backend-sources.md). Consult that ledger for DevDigest repository evidence and version/interpretation cautions before applying tool-specific examples. In particular, verify guidance against the installed Fastify 5.2, Zod 3, `fastify-type-provider-zod` 4, Drizzle, Vitest 2, dependency-cruiser 17.4.3, and deployed PostgreSQL versions described there.

## Architecture foundations

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

## Dependency injection, repositories, and transactions

- **FOW-01 · A — Martin Fowler, “Inversion of Control Containers and the Dependency Injection pattern”**
  https://martinfowler.com/articles/injection.html
  Use for separating configuration from use, constructor injection, and a distinct assembler/composition root.

- **FOW-02 · A — Martin Fowler, “Repository”**
  https://martinfowler.com/eaaCatalog/repository.html
  Use for collection-like domain-facing persistence mediation and one-way dependency through a repository interface.

- **FOW-03 · A — Martin Fowler, “Unit of Work”**
  https://martinfowler.com/eaaCatalog/unitOfWork.html
  Use for coordinating writes and concurrency across one business transaction.

## Fastify and Zod boundaries

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

## Drizzle ORM and PostgreSQL

- **DRZ-01 · B — Drizzle ORM, “SQL schema declaration”**
  https://orm.drizzle.team/docs/sql-schema-declaration
  Use for TypeScript schema ownership, exported models, and supported multi-file organization.

- **DRZ-02 · B — Drizzle ORM, “Transactions”**
  https://orm.drizzle.team/docs/transactions
  Use for implementing application-owned transaction semantics in the persistence adapter.

- **DRZ-03 · B — Drizzle ORM, “Migrations”**
  https://orm.drizzle.team/docs/migrations
  Use for the generate/apply migration workflow; DevDigest migrations remain generated rather than hand-edited.

- **PG-01 · B — PostgreSQL 17, “Constraints”**
  https://www.postgresql.org/docs/17/ddl-constraints.html
  Use for database-enforced integrity as a persistence-layer complement to domain invariants.

- **PG-02 · B — PostgreSQL, “Transaction Isolation”**
  https://www.postgresql.org/docs/current/transaction-iso.html
  Use when a use case's consistency guarantees depend on PostgreSQL isolation behavior.

- **PG-03 · B — PostgreSQL, “Row Security Policies”**
  https://www.postgresql.org/docs/current/ddl-rowsecurity.html
  Use for optional tenant defense-in-depth, not as a replacement for application authorization or scoped port methods.

## TypeScript and automated architecture enforcement

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

## Testing

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
