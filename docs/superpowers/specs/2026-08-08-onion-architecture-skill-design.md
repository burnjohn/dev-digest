# Onion Architecture backend skill design

Status: approved in conversation on 2026-08-08; written review pending before implementation planning
Canonical research ledger: [`docs/research/onion-architecture-backend-sources.md`](../../research/onion-architecture-backend-sources.md)

## Goal

Create a repository-scoped `onion-architecture` skill that makes inward dependency direction the default for new and changed DevDigest backend modules. The skill must translate Onion Architecture into concrete rules for the technologies already used by the repository: Fastify 5, TypeScript, Zod 3, Drizzle ORM, PostgreSQL, Vitest, Testcontainers, external SDKs, and the pure `reviewer-core` package.

The skill is both guidance and enforcement. It must tell an agent where code belongs, require the agent to inspect dependency direction before editing, and pair its workflow with a blocking `dependency-cruiser` gate that rejects newly introduced boundary violations.

## Scope

The skill applies to:

- `server/src/modules/**` feature modules;
- `server/src/platform/**` infrastructure and composition;
- background jobs, event streams, external service integrations, and persistence;
- backend-facing portions of `@devdigest/shared` contracts;
- `reviewer-core` when deciding whether pure review logic remains independent of delivery and infrastructure concerns.

It covers architectural placement, dependency direction, ports and adapters, dependency injection, transaction ownership, validation boundaries, mapping, testing, and incremental migration.

It does not:

- prescribe frontend architecture;
- make performance optimization its primary concern;
- require rich DDD entities, aggregates, or value objects for every CRUD operation;
- require a repository per database table;
- replace Fastify, Zod, Drizzle, PostgreSQL, or testing-specific skills;
- authorize a broad rewrite of legacy modules when a focused change can establish or improve a boundary.

## Repository context

The backend currently uses a feature-oriented module tree but does not consistently isolate layers. Representative gaps found during the repository audit are:

- services instantiate Drizzle repositories directly in `agents`, `github-tokens`, `repo-intel`, `repos`, and `reviews`;
- the `polling`, `pulls`, `settings`, and `workspace` route modules import Drizzle query primitives directly;
- several services receive the entire `Container`, turning the composition root into a service locator;
- concrete external adapters such as Octokit, code-indexing tools, Git operations, and LLM SDKs can be reached from feature services;
- `reviewer-core` is already a useful inner-core example: it is pure TypeScript, accepts an `LLMProvider`, and has no database, Fastify, GitHub, or filesystem dependency.

The design therefore uses strict rules for new or materially changed code while baselining existing violations. It does not pretend the current tree is already compliant.

## Architectural model

Each non-trivial feature should own a small, nested onion rather than contributing to repository-wide horizontal `controllers/`, `services/`, and `repositories/` buckets:

```text
server/src/modules/<feature>/
  domain/
    entities.ts
    value-objects.ts
    policies.ts
    errors.ts
  application/
    ports/
    use-cases/
    dto.ts
  adapters/
    http/
    persistence/
    external/
    jobs/
  index.ts
```

Only create directories that have a real responsibility. A small feature may begin with one use-case file, one port, and one adapter. The dependency rule matters more than a symmetrical tree.

### Dependency direction

```text
composition root
      ↓
adapters (Fastify, jobs, Drizzle, SDKs)
      ↓
application (use cases and ports)
      ↓
domain (business rules and vocabulary)
```

All source dependencies point inward. Runtime control may flow outward through a port, but the inner layer owns the interface.

| Layer | May depend on | Must not depend on |
|---|---|---|
| Domain | its own domain modules and carefully selected platform-neutral TypeScript/JavaScript APIs | Fastify, Zod schemas, Drizzle, PostgreSQL, SDKs, `Container`, HTTP DTOs, database rows |
| Application | domain, use-case DTOs, and ports owned by the use case | Fastify request/reply, Drizzle tables/query builders/transactions, concrete repositories, SDK clients, whole `Container` |
| Adapters | application ports/use cases, domain types, and the technology implemented by that adapter | another adapter's private implementation details or business policy that belongs inward |
| Composition root | all concrete implementations needed to wire the process | business decisions or request-specific orchestration |

Cross-feature imports must use a deliberate public API or a shared application/domain contract. An adapter from one feature is not a shortcut around another feature's boundary.

## Responsibility and placement rules

### Domain

The domain owns business invariants, state transitions, policies, domain errors, and stable domain vocabulary. It operates on domain values rather than transport payloads or database records.

DDD tactical patterns are optional. Use an entity, value object, aggregate, or domain service when it clarifies real domain behavior. For simple CRUD, a pure use case and explicit types are sufficient as long as the dependency direction remains intact.

### Application

Application code expresses use cases and coordinates domain behavior, authorization policy calls, persistence ports, transaction boundaries, clocks, identifiers, queues, and other capabilities. It should be thin in the DDD sense: orchestration belongs here; reusable business rules belong in the domain.

Ports are defined beside the inner consumer that needs them. Their methods use application or domain language, not generic table CRUD. Prefer `findReviewForWorkspace` or `saveRunResult` over a universal `Repository<T>` abstraction.

Every tenant-owned use case and persistence port carries `workspaceId` explicitly. Tenant scoping must not exist only in the route adapter.

### Adapters

Adapters translate between external representations and inner contracts:

- `adapters/http`: Fastify routes, request/response Zod schemas, authentication context extraction, HTTP status/error mapping, SSE transport;
- `adapters/persistence`: Drizzle schema access, SQL/query builders, row-to-domain mapping, transaction implementation, PostgreSQL-specific errors and constraints;
- `adapters/external`: Octokit, OpenAI/Anthropic, Git, ast-grep, ripgrep, code index, filesystem, and other SDK/tool integrations;
- `adapters/jobs`: queue consumers, schedulers, event subscribers, retry mechanics, and process lifecycle integration.

An adapter may call a use case or implement an inner port. It must not contain the business decision that the use case exists to enforce.

### Composition root

`server/src/app.ts` and narrowly scoped platform wiring create concrete adapters and inject them into use cases. `Container` may support this wiring during migration, but application and domain constructors must not accept the entire container.

Use constructor injection for stateful collaborators and explicit function parameters for small pure factories. Inject the narrowest capability. Configuration and implementation selection stay outside the code that uses the dependency.

## Technology mapping

### Fastify and Zod

Fastify is a driving HTTP adapter and a composition mechanism, not the application layer. A route should:

1. define or reference request and response schemas;
2. obtain authenticated/workspace context;
3. convert the validated request to a use-case input;
4. invoke one application use case;
5. map its typed result or error to HTTP/SSE output.

Zod validates unknown values at system boundaries: HTTP, configuration, event payloads, external SDK responses, and stored untrusted JSON. Domain code receives already parsed values and does not import Zod schemas merely for TypeScript typing. Shared Zod contracts remain appropriate for cross-package wire contracts, but they are not domain entities.

Asynchronous database or external-service checks belong in the use case, not Fastify's initial schema validation. Response schemas remain an adapter-level protection against accidental data disclosure.

### Drizzle and PostgreSQL

Drizzle tables, inferred row types, SQL fragments, query builders, relation loading, transaction handles, and database errors stay in persistence adapters. Each adapter maps rows to domain/application values before returning inward.

The application use case owns the business transaction boundary through an inner transaction/unit-of-work port. Its implementation may call `db.transaction`, but the Drizzle transaction type must not appear in application or domain signatures.

PostgreSQL constraints enforce storage invariants and protect data integrity. They complement domain policy; they do not replace the domain model or justify leaking SQL concerns inward. Workspace ownership must be encoded in every relevant query, with database-level defenses considered where appropriate.

### `reviewer-core`

Treat `reviewer-core` as an inner application/domain engine. Its `LLMProvider` pattern is the model for secondary ports. Server-side SDK adapters implement or wrap those ports, and Fastify/job adapters drive the engine through an application use case. Do not introduce Fastify, database, GitHub, filesystem, or concrete vendor SDK dependencies into the core.

## Enforcement strategy: strict incremental

The skill must enforce the architecture in two ways.

### Agent workflow

Before changing backend code, the agent must:

1. read the relevant `INSIGHTS.md` and package conventions;
2. classify every changed artifact as domain, application, adapter, or composition;
3. identify inbound and outbound ports and their owners;
4. inspect import direction, runtime validation, mapping, transaction, and tenant boundaries;
5. keep new violations at zero and reduce an existing violation when the task naturally touches it;
6. run focused tests, type checking, and the architecture gate.

Architecture findings are correctness findings when they allow policy bypass, tenant leakage, untestable wiring, infrastructure leakage, or accidental coupling. Pure naming or folder preference is not reported as a defect without a concrete boundary consequence.

### Automated gate

Use the repository's `dependency-cruiser@17.4.3` to express forbidden imports and cycles. Generate a checked-in `.dependency-cruiser-known-violations.json` baseline for legacy violations with `depcruise-baseline`; the gate then fails on any new violation.

Rules should cover at least:

- domain importing application, adapters, platform, Fastify, Zod, Drizzle, database code, or SDKs;
- application importing adapters, platform/container, Fastify, Drizzle, database code, or concrete SDKs;
- direct cross-feature imports into another module's private adapters;
- cycles inside and between features;
- obsolete/orphaned public-boundary mistakes where signal is reliable.

The baseline is migration debt, not an allowlist for copied patterns. Re-baselining requires explicit review and an explanation; CI must never silently regenerate it.

## Testing model

| Target | Default test | Doubles and infrastructure |
|---|---|---|
| Domain rule | fast hermetic unit test | no framework, database, container, or SDK |
| Application use case | unit test through public use-case API | in-memory/fake ports with contract-relevant behavior |
| Fastify HTTP adapter | `app.inject()` route test | real plugin wiring where practical; fake application port/use case only at the adapter seam |
| Drizzle persistence adapter | `*.it.test.ts` | real PostgreSQL through the repository Testcontainers fixture |
| External adapter | focused contract/integration test | fake remote server/client only at the actual external boundary |
| Composition root | smoke or wiring test | verify `route → use case → adapter` paths that type checking cannot prove |
| Architecture rules | dependency-cruiser fixture/gate test | include at least one forbidden-import negative fixture or config-level regression check |

Fakes should implement inner ports rather than mock Drizzle/Fastify internals. A use case test must not instantiate `Container`. Persistence behavior that depends on SQL semantics belongs in a database-backed integration test.

## Skill package design

Create the skill at:

```text
.claude/skills/onion-architecture/
  SKILL.md
  agents/
    openai.yaml
  references/
    core-rules.md
    project-mapping.md
    fastify-zod-adapters.md
    drizzle-postgres-adapters.md
    testing-and-enforcement.md
    migration-playbook.md
    source-catalog.md
```

`SKILL.md` should stay concise: triggers, mandatory workflow, non-negotiable dependency rule, reference routing, and completion checks. Detailed rules and examples belong in one-level reference files so an agent loads only what the task needs.

Reference responsibilities:

- `core-rules.md`: dependency rule, layer responsibilities, ports, use cases, domain purity, DI, DTO mapping;
- `project-mapping.md`: DevDigest package map, target feature tree, `reviewer-core`, shared contracts, jobs/SSE/external tools, cross-feature policy;
- `fastify-zod-adapters.md`: route/plugin boundaries, parsing, context, errors, serialization, HTTP/SSE testing;
- `drizzle-postgres-adapters.md`: repository semantics, mapping, transactions, tenant scoping, constraints, migrations, integration tests;
- `testing-and-enforcement.md`: test pyramid by layer, dependency-cruiser rules, baseline policy, verification commands;
- `migration-playbook.md`: how to improve a touched legacy module safely without a repository-wide rewrite;
- `source-catalog.md`: source IDs and exact URLs copied from the canonical research ledger.

No skill-local README is needed. A future project README can be generated from the canonical research ledger while retaining source IDs and URLs.

## Migration policy

For a changed legacy flow:

1. characterize current behavior with a focused test;
2. name the use case in business language;
3. define the narrow inner port required by that use case;
4. move Fastify/Zod and Drizzle/SDK translation to adapters;
5. inject concrete implementations in the composition root;
6. remove or reduce the corresponding baseline violation;
7. verify tenant scope, transaction semantics, errors, and runtime wiring.

Do not move files solely to imitate the target tree. A migration step is complete only when the dependency direction and ownership improve.

## Red flags the skill must catch

- a route executes Drizzle queries or contains business branching;
- a use case imports Fastify, Drizzle, a table schema, Octokit, OpenAI, Anthropic, Git, or `Container`;
- domain types are aliases of database rows or shared HTTP payloads;
- a repository interface mirrors every table method with generic CRUD;
- a transaction type from Drizzle crosses into the application layer;
- a persistence adapter returns raw rows or SQL errors inward;
- tenant scope is read in the route but omitted from the use-case/port call;
- an external SDK response travels through the application without validation/mapping;
- an application service locates dependencies at runtime from the whole container;
- a new architecture violation is hidden by regenerating the baseline;
- tests mock framework/ORM internals instead of exercising a port or real adapter;
- a folder structure is declared compliant while imports still point outward.

## Success criteria

The implemented skill is successful when:

- agents consistently classify backend work by layer and explain ambiguous placements;
- new domain/application code has no framework, database, SDK, or container imports;
- Fastify, Zod, Drizzle, PostgreSQL, jobs, SSE, and external services are treated as adapters;
- use cases depend on narrow inner ports and are testable without the process container;
- tenant and transaction boundaries are explicit in application contracts;
- `reviewer-core` remains infrastructure-independent;
- the dependency-cruiser gate rejects a deliberately introduced violation while tolerating only the checked-in legacy baseline;
- the skill validates structurally and passes fresh-context scenarios for new modules, legacy migrations, HTTP routes, persistence, external integrations, and reviews.
