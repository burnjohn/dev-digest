# backend-onion-architecture

**Version:** 1.0.0  
**Last updated:** 2026-06-28  
**Scope:** `server/src/modules/` — all backend modules in this project

---

## Purpose

This skill establishes the **mandatory architectural standard** for all backend modules in `server/`.

It answers one question: **"Where does this code belong, and why?"**

It does NOT answer how to write Drizzle queries, how to configure Fastify, or how to write Zod schemas — those are covered by companion skills. This skill defines the boundaries within which all other backend skills operate.

---

## Scope

### What this skill covers

- The Onion Architecture Dependency Rule and how it maps to `server/src/`
- Layer definitions: Presentation (`routes.ts`) · Application (`service.ts`) · Infrastructure (`repository.ts`) · Composition Root (`platform/container.ts`)
- Canonical structure for a new `server/src/modules/<name>/` module
- Project-specific architectural constraints (workspace scoping, Container pattern, AppError, vendor/shared immutability)
- Import dependency rules — what each layer may and may not import
- Top 5 (inline) + full 10 (extended) anti-patterns with detection + fix
- Decision criteria: when to use the 3-layer pattern vs. when to extend to full DDD Onion

### What this skill does NOT cover

| Topic | Covered by |
|---|---|
| How to write Drizzle queries, joins, transactions | `drizzle-orm-patterns` |
| How to configure Fastify plugins, hooks, serialization | `fastify-best-practices` |
| How to write Zod schemas | `zod` |
| TypeScript type-level programming, generics | `typescript-expert` |
| PostgreSQL schema design, indexes, constraints | `postgresql-table-design` |
| Frontend / React / Next.js code organization | `frontend-architecture` |
| Testing strategy and test structure | `TESTING.md` |
| Database migrations | `server/src/db/AGENTS.md` |
| CI/CD, deployment, Docker | Out of scope for skills |

---

## Typical Scenarios

| Scenario | How this skill helps |
|---|---|
| Adding a new L02–L08 feature module | Provides canonical folder structure and 3-file scaffold |
| "Where should this business logic live?" | Layer contract table: service.ts, not routes.ts |
| "Can my service import the GitHub adapter directly?" | Forbidden: must use `container.github()` |
| "Do I need to add workspace_id to this query?" | Yes — R1 rule, always, no exceptions |
| Architecture review of a new module | Anti-pattern checklist (AP-1 through AP-10) |
| "Should I create a separate repository for OrderLines?" | No — repositories at aggregate level, not table level |
| "Where do DTOs and type converters go?" | `helpers.ts` in the module — no side effects |
| "How do I handle a 'not found' case?" | `throw new NotFoundError('...')` in service.ts |
| "My new module isn't loading" | Check `modules/index.ts` registration (AP-9) |

---

## Architecture Rules

These rules are **mandatory** for all backend modules. They are not suggestions.

---

### Rule 1 — The Dependency Rule

**Rule:** Dependencies always point inward. Outer layers depend on inner layers. Inner layers never depend on outer layers.

```
Presentation → Application → (via Container) → Infrastructure
```

**Explanation:** This is the single invariant from which all other rules derive. Jeffrey Palermo (2008): *"All code can depend on layers more central, but code cannot depend on layers further out."*

**Rationale:** When infrastructure (DB, HTTP framework, LLM SDK) is at the perimeter and business logic at the center, you can change the database without touching business logic, swap the HTTP framework without touching services, and test business logic without running any external system.

---

### Rule 2 — Presentation Layer Contains No Business Logic

**Rule:** Route handlers (`routes.ts`) only: validate HTTP input with Zod → resolve workspace context → delegate to Service → return result. Never make business decisions.

**Explanation:** An `if` statement that decides whether an operation is allowed, a `throw` that represents a domain rule, or a calculation that encodes business knowledge — all of these belong in `service.ts`.

**Rationale:** Business logic in route handlers is untestable without HTTP infrastructure, not reusable across different entry points (HTTP vs. background job vs. test), and couples the HTTP protocol to domain decisions.

---

### Rule 3 — Application Layer (Service) Accesses Adapters Only via Container

**Rule:** Services receive `Container` in their constructor and call `container.github()`, `container.llm('openai')`, etc. Never import or instantiate concrete adapter classes in `service.ts`.

**Explanation:** `platform/container.ts` is the Composition Root — the one place that knows about all concrete implementations. Services depend on the interfaces defined in `@devdigest/shared`, not on the classes in `adapters/`.

**Rationale:** Tests inject mocks via `ContainerOverrides` without touching service code. Swapping an adapter (e.g., switching from OpenAI to Anthropic) requires changing only `container.ts`. Mark Seemann (2011): *"A Composition Root is a unique location in an application where modules are composed together."*

---

### Rule 4 — Infrastructure Layer (Repository) Always Scopes by workspace_id

**Rule:** Every Drizzle query in `repository.ts` must include `eq(t.tableName.workspaceId, workspaceId)` in the WHERE clause. No exceptions.

**Explanation:** This project is multi-tenant. Each workspace's data must be invisible to other workspaces. workspace_id is received from `getContext()` in the route handler and passed through the service to the repository.

**Rationale:** A missing workspace scope is a data isolation breach — one tenant can read or modify another's data. This is a security invariant, not a style preference. A query missing workspace scope passes all other tests but leaks data in production.

---

### Rule 5 — Composition Root Is Singular

**Rule:** `platform/container.ts` is the only place where concrete adapter classes are instantiated. `app.ts` is the only place that creates the Container. `modules/index.ts` is the only place that lists registered modules.

**Explanation:** These three files are the wiring layer of the application. Nothing else needs to know about the full set of dependencies.

**Rationale:** A single Composition Root makes dependency wiring auditable, prevents circular dependency issues, and ensures that the application's entire dependency graph can be understood by reading one file. Mark Seemann, *Dependency Injection in .NET*, 2011.

---

### Rule 6 — Modules Are Import-Isolated

**Rule:** A module imports only from: its own files · `@devdigest/shared` · `../../platform/container` · `../../db/schema` · `../../db/client` · `../_shared/`.  
A module never imports from another module's internal files.

**Explanation:** If module `agents` needs behavior from module `reviews`, it uses `container.reviewRepo` (shared repos on Container) or the behavior is extracted to `platform/`. Direct cross-module imports create hidden coupling.

**Rationale:** Module isolation ensures each module can be understood, tested, and eventually extracted as a microservice independently. Cross-module imports create hidden coupling that makes refactoring and lesson-by-lesson development unpredictable.

---

### Rule 7 — Expected Failures Use AppError

**Rule:** All expected business failures (not found, unauthorized, validation, quota exceeded) throw a typed error from `platform/errors.ts`. Never throw `new Error(...)` or plain strings from services.

**Explanation:** Fastify's error handler in `app.ts` catches `AppError` and its subclasses and serializes them to the `ApiErrorBody` envelope `{ error: { code, message, details } }`. Raw errors produce unstructured 500 responses.

**Available types:** `AppError(code, message, statusCode)` · `NotFoundError` · `ValidationError` · `ExternalServiceError` · `ConfigError`

**Rationale:** Consistent error taxonomy makes the API predictable for frontend consumers and makes error handling in the client deterministic. A well-named error code (`not_found`, `quota_exceeded`) is a contract; a message string is not.

---

### Rule 8 — Secrets Only via SecretsProvider

**Rule:** Never read API keys, tokens, or credentials from `process.env` directly in services, repositories, or adapters outside of `platform/container.ts`. Use `await this.container.secrets.get('KEY_NAME')`.

**Explanation:** `SecretsProvider` (interface in `@devdigest/shared`, implementation in `adapters/secrets/local.ts`) abstracts the secret source. In development it reads `~/.devdigest/secrets.json`. A different implementation could read from AWS Secrets Manager without changing any service code.

**Rationale:** Direct `process.env` reads scatter secret access across the codebase, make it impossible to test without real keys, risk accidental logging of secrets, and couple the code to a specific secret storage mechanism.

---

### Rule 9 — vendor/shared Is Read-Only

**Rule:** Never add, edit, or remove files in `server/src/vendor/shared/`. This package (`@devdigest/shared`) is consumed by `client/`, `reviewer-core/`, and `e2e/` simultaneously via TypeScript path aliases.

**Explanation:** A single change to `vendor/shared/` breaks compilation in all four packages at once. New shared types or interfaces must be explicitly justified and reviewed as a cross-package change.

**Rationale:** The project has no published npm packages — cross-package sharing is done via path aliases that point at source files. Changes propagate immediately to all consumers with no intermediate build step.

---

### Rule 10 — Module Registration Is Always Explicit

**Rule:** Every new module must be explicitly added to `modules/index.ts` with an import and an entry in the `modules` record. No auto-discovery.

**Explanation:** Auto-discovery via `fs.readdir` or `import.meta.glob` works differently under `tsx`, the TypeScript bundler, and `vitest`. Static registration produces identical behavior in all three environments.

**Rationale:** The static registry is the authoritative source of what modules are active. It documents which modules exist, serves as the registration checklist when adding L02–L08 features, and prevents modules from loading accidentally or in the wrong order.

---

## Relationship to Other Skills

### Responsibility Matrix

| Question | Skill |
|---|---|
| WHERE does this backend code go? | **backend-onion-architecture** |
| WHY can't this layer import that? | **backend-onion-architecture** |
| What's the 3-layer contract for a module? | **backend-onion-architecture** |
| HOW do I write a Drizzle query? | `drizzle-orm-patterns` |
| HOW do I configure a Fastify route or plugin? | `fastify-best-practices` |
| HOW do I write a Zod schema? | `zod` |
| HOW do I type something complex in TypeScript? | `typescript-expert` |
| WHERE does this React/Next.js code go? | `frontend-architecture` |
| HOW do I design a PostgreSQL table? | `postgresql-table-design` |

**Boundary principle:** `backend-onion-architecture` answers **WHERE** and **WHY**. All other backend skills answer **HOW**.

---

## Differences from Frontend Skills

### vs. `react-best-practices`

`react-best-practices` covers React component design patterns, hooks rules (useEffect, useMemo, useCallback), state management, rendering performance, and component composition. It is entirely about the React programming model and has no architectural scope.

`backend-onion-architecture` covers the macro architecture of the Node.js server: which files exist, what each file is responsible for, and which imports are allowed. These skills operate at different levels of the stack and have zero overlap.

---

### vs. `next-best-practices`

`next-best-practices` covers Next.js-specific APIs: the App Router file conventions (`page.tsx`, `layout.tsx`, `error.tsx`), React Server Components vs. Client Components boundaries, the `async/await` patterns for Server Components, `metadata`, image and font optimization, and route handlers.

`backend-onion-architecture` covers the Fastify API server in `server/`, which is a completely separate process from the Next.js frontend in `client/`. The two skills cover different processes, different frameworks, and different concerns.

---

### vs. `vercel-react-best-practices` (if installed)

`vercel-react-best-practices` covers Vercel deployment-specific patterns: Edge Runtime, ISR (Incremental Static Regeneration), Vercel-specific environment variables, and deployment configuration. It is deployment-infrastructure-focused.

`backend-onion-architecture` covers application architecture at the code level, not deployment. The API server in `server/` is not deployed on Vercel (it uses Docker/Node.js). There is no overlap.

---

## Source Catalog

All sources used in the research and knowledge base that informed this skill.

### Foundational Sources

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 1 | The Onion Architecture: Part 1 | Jeffrey Palermo | https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/ | Original definition, fundamental rule, database externalization | **High** |
| 2 | The Onion Architecture: Part 2 | Jeffrey Palermo | https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/ | Dependency injection, IoC, application core interfaces | **High** |
| 3 | The Onion Architecture: Part 3 | Jeffrey Palermo | https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/ | Four formal tenets, infrastructure as commodity, testing placement | **High** |
| 4 | The Onion Architecture: Part 4 (retrospective) | Jeffrey Palermo | http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/ | Four-year production retrospective | **High** |
| 5 | The Clean Architecture | Robert C. Martin | https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html | Dependency Rule, four rings, synthesis of Onion/Hexagonal/DCI | **High** |
| 6 | Screaming Architecture | Robert C. Martin | https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html | Use case-driven folder structure | **High** |
| 7 | Hexagonal Architecture (original) | Alistair Cockburn | https://alistair.cockburn.us/hexagonal-architecture | Ports, adapters, primary/secondary distinction | **High** |
| 8 | Layers, Onions, Ports, Adapters: it's all the same | Mark Seemann | https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/ | Equivalence proof, Dependency Inversion Principle | **High** |
| 9 | Vertical Slice Architecture | Jimmy Bogard | https://www.jimmybogard.com/vertical-slice-architecture/ | Critique of layered architecture, feature-slice alternative | **High** |
| 10 | Hexagonal Architecture (Wikipedia) | Various | https://en.wikipedia.org/wiki/Hexagonal_architecture_(software) | Overview, history, comparison | **Medium** |

### Microsoft / Enterprise References

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 11 | Designing a DDD-oriented microservice | Microsoft | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice | DDD layers, domain model purity, application/infrastructure layer | **High** |
| 12 | Tackling Business Complexity — DDD and CQRS | Microsoft | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ | DDD/CQRS patterns series, eShopOnContainers reference | **High** |
| 13 | Domain events: Design and implementation | Microsoft | https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation | Domain events, handlers in application layer, integration events | **High** |

### Node.js / TypeScript Implementations

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 14 | Implementing SOLID and the Onion Architecture in Node.js with TypeScript and InversifyJS | Remo Jansen | https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad | Full TypeScript implementation, InversifyJS, generic repository, data mapper | **High** |
| 15 | Implementing SOLID and Onion Architecture (original blog) | Remo Jansen | http://blog.wolksoftware.com/implementing-solid-and-the-onion-architecture-in-node-js-with-typescript-and-inversifyjs | Same, original location | **High** |
| 16 | Clean Architecture with TypeScript: DDD, Onion | André Bazaglia | https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/ | Inversify, folder structure, factory patterns, in-memory repos | **High** |
| 17 | Clean Node.js Architecture | Khalil Stemmler | https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/ | Policy vs Detail, Ports & Adapters in Node.js, domain layer isolation | **High** |
| 18 | Onion Architecture in Node.js with TypeScript | Sankhadip Samanta | https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391 | Layer implementation, practical Node.js patterns | **Medium** |
| 19 | onion-architecture-boilerplate (GitHub) | Melzar | https://github.com/Melzar/onion-architecture-boilerplate | Full Express/TypeScript boilerplate, Unit of Work, data mappers, GraphQL | **High** |
| 20 | Domain-Driven Design Introduction | Khalil Stemmler | https://khalilstemmler.com/articles/domain-driven-design-intro/ | Entities, Value Objects, Aggregates, Repositories, Domain Events in TypeScript | **High** |
| 21 | Domain Entities (DDD w/ TypeScript) | Khalil Stemmler | https://khalilstemmler.com/articles/typescript-domain-driven-design/entities/ | Entity base class, identity-based equality, lifecycle | **High** |
| 22 | Value Objects (DDD w/ TypeScript) | Khalil Stemmler | https://khalilstemmler.com/articles/typescript-value-object/ | Value object pattern, structural equality, immutability | **High** |
| 23 | How to Design & Persist Aggregates | Khalil Stemmler | https://khalilstemmler.com/articles/typescript-domain-driven-design/aggregate-design-persistence/ | Aggregate design, persistence, aggregate root | **High** |
| 24 | Where Do Domain Events Get Dispatched | Khalil Stemmler | https://khalilstemmler.com/blogs/domain-driven-design/where-do-domain-events-get-dispatched/ | Domain event dispatch timing, aggregates, application layer | **High** |
| 25 | Patterns for designing flexible architecture in Node.js (CQRS/ES/Onion) | Domagoj Kriskovic | https://medium.com/@domagojk/patterns-for-designing-flexible-architecture-in-node-js-cqrs-es-onion-7eb10bbefe17 | CQRS + Event Sourcing + Onion in Node.js | **High** |
| 26 | Onion Architecture in Node.js — Building maintainable software | Marco Schaefer | https://marcoatschaefer.medium.com/onion-architecture-explained-building-maintainable-software-54996ff8e464 | Layer explanations, practical patterns | **Medium** |

### Repository and Transaction Patterns

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 27 | Repository Pattern in NestJS with Drizzle ORM | vimulatus | https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae | Drizzle ORM repository, nestjs-cls, @Transactional, transactions | **High** |
| 28 | Transactions with DDD and Repository Pattern in TypeScript (Part 2) | João Batista da Silva | https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901 | Unit of Work, Drizzle transactions, repository interface modification | **High** |
| 29 | Clean Architecture in Node.js: Repository Pattern with Prisma | Alex Rusin | https://blog.alexrusin.com/clean-architecture-in-node-js-implementing-the-repository-pattern-with-typescript-and-prisma/ | Prisma repository, mixin composition, interface contracts | **High** |
| 30 | Atomic Repositories in Clean Architecture | Sentry | https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/ | Atomic operations, transaction management across repositories | **High** |
| 31 | Drizzle ORM Transactions | Drizzle Team | https://orm.drizzle.team/docs/transactions | Official Drizzle transaction API | **High** |
| 32 | API with NestJS #153: SQL transactions with Drizzle ORM | Wanago | https://wanago.io/2024/06/17/api-nestjs-drizzle-sql-transactions/ | NestJS + Drizzle transactions in practice | **High** |

### Architecture Comparisons

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 33 | Onion Architecture: The Software Architecture Chronicles | Herberto Graça | https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85 | History, comparison with Ports & Adapters, evolutionary context | **High** |
| 34 | Clean Architecture vs. Onion Architecture vs. Hexagonal Architecture | CCD-Akademie | https://ccd-akademie.de/en/clean-architecture-vs-onion-architecture-vs-hexagonal-architecture/ | Three-way comparison, criticism of DIP-heavy approaches | **High** |
| 35 | Onion Architecture vs Hexagonal Architecture | Javed Iqbal | https://medium.com/codex/onion-architecture-vs-hexagonal-architecture-67ac670bb691 | Direct comparison, structural differences | **Medium** |
| 36 | N-Tier vs Hexagonal vs Onion vs Clean Architecture | Dorin Baba | https://medium.com/@dorinbaba/n-tier-vs-hexagonal-vs-onion-vs-clean-architecture-in-very-simple-terms-68f66c4dba22 | Four-way comparison | **Medium** |
| 37 | The Problem with Clean Architecture: Vertical Slices | Mehmet Ozkaya | https://medium.com/design-microservices-architecture-with-patterns/the-problem-with-clean-architecture-vertical-slices-111537c0ffcb | Clean Architecture critiques, Vertical Slice solution | **Medium** |
| 38 | Onion Architecture: Going Beyond Layers | NDepend Blog | https://blog.ndepend.com/onion-architecture-layers/ | Layer analysis, dependency analysis tooling | **Medium** |
| 39 | Stop Confusing Clean, Onion & Hexagonal Architecture | Rup Singh | https://medium.com/@rup.singh88/stop-confusing-clean-onion-hexagonal-architecture-heres-when-to-use-each-692079e56267 | When to use each, decision criteria | **Medium** |

### NestJS-Specific

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 40 | Implementing Onion Architecture in NestJS | Amr Abdalla | https://dev.to/amroabdalla00/implementing-onion-architecture-in-nestjs-1k2f | NestJS modules → Onion layer mapping | **Medium** |
| 41 | Hexagonal, Onion, and Clean Architecture in NestJS | GAIDI | https://medium.com/@lamjed.gaidi070/hexagonal-onion-and-clean-architecture-in-nestjs-c58b526d9f3f | All three architectures in NestJS | **Medium** |
| 42 | Building Maintainable NestJS Apps with Clean Architecture | Sebastian Iwanczyszyn | https://medium.com/@sebastian.iwanczyszyn/building-maintainable-nestjs-apps-with-clean-architecture-056248f04cef | NestJS DI, module structure, layer separation | **Medium** |

### Fastify-Specific

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 43 | fastify-clean-architecture (GitHub) | revell29 | https://github.com/revell29/fastify-clean-architecture | Fastify + Clean Architecture + TypeScript boilerplate | **Medium** |
| 44 | clean-architecture-fastify-mongodb (GitHub) | borjatur | https://github.com/borjatur/clean-architecture-fastify-mongodb | Fastify project template with Clean Architecture | **Medium** |
| 45 | Fastify TypeScript Documentation | Fastify Team | https://fastify.dev/docs/latest/Reference/TypeScript/ | Official Fastify TypeScript integration | **High** |
| 46 | Fastify Validation and Serialization | Fastify Team | https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ | JSON Schema validation, serialization hooks | **High** |
| 47 | Fastify Logging | Fastify Team | https://fastify.dev/docs/latest/Reference/Logging/ | Pino integration, request logging, child loggers | **High** |

### Domain-Driven Design References

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 48 | DDD, Hexagonal, Onion, CQRS, ES — full TypeScript/NestJS example | Bitloops | https://github.com/bitloops/ddd-hexagonal-cqrs-es-eda | Complete DDD+Hexagonal+CQRS+ES in TypeScript/NestJS | **High** |
| 49 | Domain-Driven Design in TypeScript | Spaceout | https://www.spaceout.pl/domain-driven-design-in-typescript/ | Entities, value objects, aggregates in TypeScript | **Medium** |
| 50 | Leveraging TypeScript for Domain-Driven Design | LogRocket | https://blog.logrocket.com/typescript-domain-driven-design/ | Practical DDD implementation in TypeScript | **Medium** |
| 51 | Onion Architecture in Domain-Driven Design (DDD) | Yasmine | https://dev.to/yasmine_ddec94f4d4/onion-architecture-in-domain-driven-design-ddd-35gn | DDD → Onion layer mapping, folder structure | **Medium** |
| 52 | Domain-Driven Design & Onion Architecture | Avenue Code Blog | https://blog.avenuecode.com/domain-driven-design-and-onion-architecture | Domain services vs Application services distinction | **Medium** |

### Production Experience

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 53 | Onion Architecture (Allegro Tech Blog) | Allegro Engineering | https://blog.allegro.tech/2023/02/onion-architecture.html | Library system example, build tool enforcement, production experience | **High** |
| 54 | Onion Architecture: Let's slice it like a Pro | Ritesh Kapoor (Expedia) | https://medium.com/expedia-group-tech/onion-architecture-deed8a554423 | Enterprise usage, DTOs, domain/application services distinction | **High** |
| 55 | Onion Architecture in Development | GlobalCloudTeam | https://www.globalcloudteam.com/onion-architecture-in-development/ | Advantages/disadvantages, team size considerations | **Medium** |
| 56 | Embracing Complexity with Elegance | DEV Community | https://dev.to/dev3l/embracing-complexity-with-elegance-why-large-corporations-are-turning-to-onion-architecture-3plm | Corporate adoption, scalability benefits | **Medium** |

### Dependency Injection Containers

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 57 | InversifyJS Documentation | InversifyJS | https://inversify.io/ | Full IoC container, decorators, binding lifecycle | **High** |
| 58 | Top 5 TypeScript DI Containers | LogRocket | https://blog.logrocket.com/top-five-typescript-dependency-injection-containers/ | InversifyJS, tsyringe, awilix, typedi comparison | **High** |
| 59 | Dependency Injection Beyond NestJS (tsyringe vs InversifyJS) | Leapcell | https://leapcell.io/blog/dependency-injection-beyond-nestjs-a-deep-dive-into-tsyringe-and-inversifyjs | Deep dive comparison, when to choose each | **High** |

### Validation (Zod)

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 60 | How to use Zod in a clean architecture setup? (GitHub discussion) | colinhacks/zod | https://github.com/colinhacks/zod/issues/813 | Community discussion on Zod placement in layers | **High** |
| 61 | fastify-zod-openapi (GitHub) | samchungy | https://github.com/samchungy/fastify-zod-openapi | Zod + Fastify + OpenAPI integration | **High** |

### Background Jobs

| # | Title | Author | URL | Topics | Authority |
|---|---|---|---|---|---|
| 62 | BullMQ Documentation | BullMQ | https://bullmq.io/ | Official BullMQ API, workers, queues, job types | **High** |
| 63 | Background Job Processing in Node.js | DEV Community | https://dev.to/young_gao/background-job-processing-in-nodejs-bullmq-queues-and-worker-patterns-31d4 | BullMQ patterns, architecture integration | **Medium** |

---

## File Structure

```
.claude/skills/backend-onion-architecture/
├── README.md                        # This file — human-facing documentation
├── SKILL.md                         # Core skill content — loaded into agent context
└── examples/
    ├── reference-module.md          # Complete annotated module (routes + service + repo)
    └── antipatterns.md              # Extended anti-pattern catalog (AP-1 through AP-10)
```

---

## Changelog

### v1.0.0 — 2026-06-28

- Initial release
- Based on comprehensive research covering 63 authoritative sources
- Grounded in actual project architecture: `platform/container.ts`, `modules/`, `platform/errors.ts`
- 8 sections in SKILL.md (dense, scannable)
- 10 architecture rules in README with explanations and rationale
- 10 named anti-patterns: 5 inline in SKILL.md, 10 extended in `examples/antipatterns.md`
- Complete annotated reference module in `examples/reference-module.md`
- Full 63-source catalog
