# Onion Architecture (backend) — research sources & skill plan

Raw material and the plan for the future `onion-architecture` skill. Compiled
2026-08-04 from three parallel deep-research passes: **A** the Onion Architecture
canon and its modern interpretation · **B** Fastify/Node layering and dependency
injection · **C** the data/persistence layer, validation, and testing. All URLs
were fetched and verified to resolve on 2026-08-04 (per-URL caveats noted inline).

Scope note: this skill owns **structural decisions for the backend** — layers,
dependency direction, where logic/ports/adapters/repositories live, DI, transaction
boundaries, validation placement, and test shape. It must not duplicate sibling
skills: `fastify-best-practices` owns Fastify mechanics (plugins, hooks, schemas,
lifecycle), `drizzle-orm-patterns` owns query/migration idioms, `zod` owns schema
idioms, `postgresql-table-design` owns physical schema design. This skill is the
backend counterpart of `frontend-ui-architecture` and follows its format.

---

## 1. The canon — Onion, Hexagonal, Clean

### The Onion Architecture, parts 1–3 — Jeffrey Palermo (2008)
- https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/
- https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/
- The post that coined the term. Fundamental rule: "All code can depend on layers
  more central, but code cannot depend on layers further out from the core."
- The four tenets (part 3, verbatim): the application is built around an independent
  object model; inner layers define interfaces, outer layers implement them;
  direction of coupling is toward the center; all application core code can be
  compiled and run separate from infrastructure.
- Repository *interfaces* live in the core; implementations at the edge. "The
  database is not the center. It is external."
- Explicit applicability caveat: **not for small websites** — for long-lived
  business applications with complex behavior.

### Onion Architecture: Part 4 — After Four Years — Jeffrey Palermo (2013)
- https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/
- All four tenets reaffirmed unchanged; corrects the top misconception: DI
  containers are optional tooling, not part of the pattern.
- Paradigm-agnostic: works with DDD, CQRS, and plain forms-over-data alike — it is
  about layering and dependency direction, not methodology.

### Hexagonal Architecture (Ports and Adapters) — Alistair Cockburn (~2005)
- https://alistair.cockburn.us/hexagonal-architecture/
- Intent: the app "equally driven by users, programs, automated test or batch
  scripts, and developed and tested in isolation from its eventual run-time
  devices and databases."
- **Primary/driving** ports (users, tests drive the app) vs **secondary/driven**
  ports (the app drives databases, notification services). Adapters convert
  technology-specific signals to/from application calls.

### The Clean Architecture — Robert C. Martin (2012)
- https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Presents itself as a unification of Hexagonal, Onion, and friends. **The
  Dependency Rule**: "source code dependencies can only point inwards."
- Boundary-crossing data: "isolated, simple, data structures are passed across the
  boundaries" — never database rows, entities, or framework types (the canonical
  justification for DTOs at boundaries).

### Layers, Onions, Ports, Adapters: it's all the same — Mark Seemann (2013)
- https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/
- Applying DIP to a traditional layered diagram mechanically produces the onion;
  flattening it yields Ports & Adapters — the three names are **the same pattern**.
- Prefers flatter dependency hierarchies over deeply nested ones — a caution
  against over-layering the onion.

### Explicit Architecture: DDD, Hexagonal, Onion, Clean, CQRS — Herberto Graça (2017)
- https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/
- The best single synthesis. "A port is nothing more than a specification" of how a
  tool interacts with the core — and that specification **belongs inside the core**.
- Application core = application layer (use cases) + domain layer (entities, value
  objects, domain services); UI and infrastructure surround it.
- Advocates **package by component** (bounded context / feature) over package by
  layer — layers organize the inside of a component, not the repo root.

## 2. Applying it in practice — layers, rich models, criticisms

### Designing a DDD-oriented microservice — Microsoft .NET architecture docs
- https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice
- Application depends on Domain and Infrastructure; Infrastructure depends on
  Domain; **Domain depends on nothing** (Persistence Ignorance: POCOs, no ORM base
  classes).
- Evans on the application layer: it "is kept thin… only coordinates tasks and
  delegates work to collaborations of domain objects."
- Domain entities must not reach the presentation layer — DTOs/ViewModels are outer
  models; entities are **always-valid** while UI data may not be validated yet.
- Pragmatic caveat from Microsoft itself: DDD layering "should be applied only if
  you are implementing complex microservices with significant business rules";
  CRUD services can be simpler. And: persistence *ignorance* is not persistence
  *obliviousness* — ignore storage in dependencies, not in design.

### AnemicDomainModel — Martin Fowler (2003)
- https://martinfowler.com/bliki/AnemicDomainModel.html
- Anemic models "incur all of the costs of a domain model, without yielding any of
  the benefits" — if domain objects are data bags, you're paying mapping costs for
  nothing.
- Thin services are fine **when the model underneath is behaviorally rich**;
  services coordinate, domain objects decide. Match model richness to rule
  complexity.

### How to Organize Your App's Logic — Khalil Stemmler (~2019–2020)
- https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/
- Layer map for a Node/TS backend: Domain (entities, rules) → Application (use
  cases as commands/queries) → Adapters/Infrastructure (controllers, ORM repos,
  third-party clients).
- Stability argument: the most volatile code (presentation, infrastructure) depends
  on the most stable (domain), never the reverse.
- Companion pieces: use cases — https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/ ;
  DTOs/mappers/repositories — https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/ ;
  reference repo — https://github.com/stemmlerjs/ddd-forum (subdomain folders, four
  layers inside each: domain / application / adapter / infrastructure).
- Note: this is the **maximal** end of the spectrum for TS; the calibration sources
  below say when that much ceremony is overkill.

### Vertical Slice Architecture — Jimmy Bogard (2018) — the respected critique
- https://www.jimmybogard.com/vertical-slice-architecture/
- Rigid "Controller MUST talk to a Service that MUST use a Repository" chains
  create abstractions "around things that really shouldn't be abstracted."
- Real changes are feature-shaped; horizontal layers force every change through
  every layer; layer-per-abstraction designs produce mock-heavy tests that verify
  the architecture, not the behavior.
- "Minimize coupling between slices, maximize coupling in a slice" — let each slice
  pick its internal pattern (transaction script for simple, rich domain for
  complex). Compatible with Graça: components outside, onion inside where warranted.

## 3. Fastify — official structure & maintainer practice

### Fastify docs — Encapsulation · Plugins Guide · Decorators · Validation
- https://fastify.dev/docs/latest/Reference/Encapsulation/ (note: the `Guides/` URL 404s)
- https://fastify.dev/docs/latest/Guides/Plugins-Guide/
- https://fastify.dev/docs/latest/Reference/Decorators/
- https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Fastify's structuring primitive is the *encapsulation context*: visibility flows
  strictly downward; `fastify-plugin` deliberately hoists decorators to the parent —
  the sanctioned mechanism for cross-cutting infrastructure while feature code
  stays encapsulated.
- Decorators are a scoped service locator with dependency declaration and collision
  detection; reference-typed request decorators are blocked (shared-state hazard).
- Validation is a **route-boundary** concern compiled at boot, not something
  handlers do; response serialization schemas are an output **allowlist** that
  "prevents accidental disclosure of sensitive data" — a delivery-layer security
  boundary with no analogue in generic onion literature.
- The docs are deliberately unopinionated above the plugin level — layering
  opinions come from the demo repos, the book, and maintainer talks.

### fastify/demo — official reference app · delvedor/fastify-example
- https://github.com/fastify/demo — "best practices by the Fastify community":
  `plugins/` (split `external/` infra vs `app/` custom) + `routes/` by feature +
  `schemas/`; separate `app.ts` vs `server.ts`.
- https://github.com/delvedor/fastify-example — Fastify co-creator: "two top level
  folders, `plugins` and `routes`"; plugins = shared cross-cutting code, routes =
  business logic by feature.
- The honest baseline: the Fastify org itself demonstrates *less* layering than
  textbook onion — feature logic inside route modules, boundaries via encapsulation.

### Matteo Collina — Building a Modular Monolith with Fastify (Node Congress 2023)
- https://gitnation.com/contents/building-a-modular-monolith-with-fastify
- MVC "doesn't scale well in complexity" — "structure your application by domains,
  by feature." Plugin encapsulation gives zero-cost module isolation.
- "An API is a contract between people" — schemas on every route, for security,
  performance, and inter-team communication.
- Pragmatism: full transport/domain separation is a "gargantuan effort" —
  prioritize domain boundaries over ceremony.
- Related: https://blog.platformatic.dev/fastify-fundamentals-a-quick-guide-to-plugins-and-encapsulation-with-platformatic

### Accelerating Server-Side Development with Fastify — Spigolon, Sinik, Collina (Packt 2023)
- https://backend.cafe/the-fastify-book-is-out (O'Reilly page 403s to anonymous fetch)
- The closest thing to an official structuring manual: app assembled from plugins,
  feature routes as encapsulated modules, schemas on every route, dedicated
  project-structure chapter.

### fastify-type-provider-zod — turkerdev
- https://github.com/turkerdev/fastify-type-provider-zod
- Swaps Ajv for zod via `setValidatorCompiler`/`setSerializerCompiler`; one zod
  schema at the boundary does runtime transport validation *and* static handler
  types. (This repo already uses it — validation is schema-first per `server/CLAUDE.md`.)

## 4. Node layering & dependency injection

### Node.js Best Practices §1.2 — layer your components — Yoni Goldberg et al.
- https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/createlayers.md
- Three layers per business component: **entry-points** (adapt payload, first
  validation, delegate) → **domain** (services, DTOs; protocol-agnostic plain
  objects in/out) → **data-access** (repository returning DB-agnostic objects).
- Hard rule: never pass framework objects (`req`/`res`) into the domain layer.
- Explicitly pitches three flat layers as the sweet spot vs full Clean Architecture
  ceremony. Companion: partition by business component first, layers inside each.
- Applied to Fastify concretely in https://github.com/practicajs/practica ("Our
  default setup includes Fastify for the web layer"; "simple functions calling
  other functions" — anti-heavy-abstraction, pro-layering).

### Functional ports-and-adapters in TS — Jamie Breck-McKye
- https://github.com/jbreckmckye/node-typescript-architecture
- Hexagonal with no classes and no DI container: ports are plain TS interfaces,
  adapters are modules implementing them, domain functions receive ports as
  arguments.

### Dependency Injection in Node.js & TypeScript — Petar Ivanov (2026)
- https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you
- DI is primarily a **testability** play; `vi.mock()`-based testing is brittle.
- Prescription: factory functions taking a dependencies object + one **composition
  root**; tests pass plain objects satisfying the interface — no mocking framework.
- Adopt a container only when the graph is genuinely complex (~20–30+ services),
  "not because it's 'proper'."

### @fastify/awilix + the issue that spawned it
- https://github.com/fastify/fastify-awilix · https://github.com/fastify/fastify/issues/2587
- Containers are *sanctioned* (plugin lives in the fastify org) but opt-in; its
  real differentiators are per-request scoping and automatic disposal
  (`disposeOnClose`/`disposeOnResponse`). Core Fastify deliberately ships no DI
  beyond decorators.

## 5. Data layer — repositories, Drizzle, transactions

### Repository — P of EAA catalog — Hieatt & Mee on martinfowler.com (2003)
- https://martinfowler.com/eaaCatalog/repository.html
- "Mediates between the domain and data mapping layers using a collection-like
  interface for accessing domain objects" — a one-way dependency between domain
  and data mapping; pays off most with heavy querying.

### Drizzle is architecture-agnostic — docs + maintainer discussion
- https://orm.drizzle.team/docs/overview — "headless ORM," SQL-first, deliberately
  thin; the docs make **no architectural recommendations at all**.
- https://github.com/drizzle-team/drizzle-orm/discussions/232 — maintainer
  (AndriiSherman): Drizzle core intentionally mirrors SQL and "leaves abstraction
  patterns to users"; any higher-level layer would be a separate package. Official
  stance: bring your own architecture.

### Avoiding the Repository Pattern with an ORM — Derek Comartin, CodeOpinion (2019)
- https://codeopinion.com/avoiding-the-repository-pattern-with-an-orm/
- The pragmatic critique: an ORM context already *is* a repository + unit of work;
  wrappers that leak query builders abstract nothing; plain collections breed a
  pile of `findByXAndY` methods.
- Repositories still earn their keep for **aggregate roots** and **genuinely
  swappable implementations** — otherwise query the ORM directly in the
  application layer. Written against EF Core; transfers 1:1 to Drizzle.

### Drizzle-specific repository & transaction patterns
- https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/ —
  Lazar Nikolov (Sentry, 2024): repositories take an **optional transaction
  parameter** typed via Drizzle's `Transaction` type; the caller starts
  `db.transaction()` high in the stack and passes the handle down — a lightweight
  unit of work; covers savepoints and rollback.
- https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/ —
  Paul Serban (undated): repositories express **business operations, not table
  operations**; never expose DB types to API layers; no `beginTransaction` on
  repositories — callers own transaction boundaries.
- https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901 —
  da Silva (2023): the explicit unit-of-work treatment for Drizzle; honest about
  the leak when a use case imports the connection to open a transaction.
- https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae —
  vimulatus (2025): pro-repository NestJS treatment; documents the competing
  AsyncLocalStorage/CLS transaction-propagation style and its framework coupling.

## 6. Validation — parse, don't validate

### Parse, don't validate — Alexis King (2019)
- https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/
- Validation checks a property and throws the knowledge away; parsing "consumes
  less-structured input and produces more-structured output" carrying the proof in
  its type. Check invariants **once, at the boundary**.
- Names "shotgun parsing" (mixing validation with processing) as a security and
  correctness hazard; make illegal states unrepresentable.

### Zod as the boundary mechanism
- https://zod.dev/basics — `safeParse` for boundary code; `z.infer` makes the
  schema the single source of truth for DTO types.
- https://zod.dev/api (Branded types) — `.brand()` gives nominal typing so only
  parsed values flow inward; caveat verbatim: "branded types do not affect the
  runtime result of `.parse`. It is a static-only construct."
- https://www.totaltypescript.com/four-essential-typescript-patterns — Matt Pocock:
  branded types as validation boundaries in plain TS (when the domain layer
  shouldn't import zod).

### Always-Valid Domain Model — Vladimir Khorikov (2021)
- https://enterprisecraftsmanship.com/posts/always-valid-domain-model/
- The canonical two-kinds-of-validation split: boundary validation filters
  untrusted input (invalid input is *not* exceptional — model as a Result/400);
  domain invariants are assumed to hold past the boundary — a violation inside the
  domain is a **bug** and warrants an exception.
- Companion: https://khorikov.org/posts/2022-06-06-validation-vs-invariants/

## 7. Functional core, imperative shell

- https://www.destroyallsoftware.com/talks/boundaries — Gary Bernhardt (SCNA 2012),
  the origin; simple values as boundaries between subsystems. (The FCIS screencast
  itself is paywalled — cite the free talk.)
- https://kennethlange.com/functional-core-imperative-shell/ — Kenneth Lange
  (2021/2022): core = pure functions over immutable values; shell = DB/UI/network;
  the core cannot call the shell or even know it exists — the same rule as the
  onion. Points to Wlaschin's *Domain Modeling Made Functional* for further reading.
- https://medium.com/@magnusjt/functional-core-imperative-shell-in-javascript-29bef2353ac2 —
  Magnus Tovslid (2019), the Node treatment: pure core needs zero mocks; the thin
  shell is covered by **integration tests** — the FCIS-to-testing-diamond bridge.
  Honest limit: "many simple apps" are fine with integration tests alone.

## 8. Testing a layered backend

### Testing of Microservices (the honeycomb) — Spotify Engineering (2018)
- https://engineering.atspotify.com/2018/01/testing-of-microservices
- Many integration tests (the service in isolation through its real contracts,
  real DB), few implementation-detail unit tests, ideally zero "integrated" tests
  that depend on another system's correctness.
- "The interesting complexity is at the boundaries"; the microservice is the new
  unit — test from its edges.

### Node.js Testing Best Practices — Yoni Goldberg (updated 2025)
- https://github.com/goldbergyoni/nodejs-testing-best-practices/blob/master/README.md
- "The first tests to write should be component tests" — the whole service through
  its API, database included; unit tests reserved for non-trivial algorithms
  (i.e., the domain core); only 3–10 E2E tests.
- "Use the same DB product that is being used in production" via containers —
  never mock the DB; run real migrations; tune for speed.
- Fake **other people's services, not your own code** — intercept outbound HTTP,
  deny unmocked network by default; assert outgoing payloads (contract testing of
  adapters).

### Testcontainers for Node.js — official docs
- https://node.testcontainers.org/
- Real throwaway Postgres in tests; PostgreSQL module, wait strategies, automatic
  lifecycle. Pairs with Vitest globalSetup for running Drizzle migrations before
  the suite. (This repo already uses it — `@testcontainers/postgresql` in
  `server/package.json`, `*.it.test.ts` lane.)

---

## 9. Cross-source consensus (skeleton for the skill)

1. **Dependencies point inward, always** — inner layers never reference outer ones
   (Palermo tenet 3; Martin's Dependency Rule; Seemann; Graça; Microsoft).
2. **The domain is the center; the database, ORM, web framework, and LLM SDKs are
   external details** (Palermo; Cockburn; Martin).
3. **Inner layers define interfaces; outer layers implement them.** Ports live in
   the core; adapters (including test mocks) implement them outside (Palermo
   tenet 2; Cockburn; Graça; Stemmler).
4. **The core must compile and test with no infrastructure present** — swappable
   mocks are the proof (Palermo tenet 4; Cockburn; Microsoft's POCO rule).
5. **Package by feature/component first, layer inside each** — Collina, Graça,
   Goldberg, Stemmler all reject organizing the whole app by technical layer.
6. **Route handlers stay thin: adapt → validate → delegate → map result.** Framework
   objects (`request`/`reply`) never cross into services/domain (Goldberg's hard
   rule; Stemmler; Graça's driving adapters).
7. **Application services are thin orchestration; rules live in the domain** —
   prefer rich over anemic models *where rules exist*; match model richness to
   rule complexity (Evans via Fowler and Microsoft; Bogard's carve-out).
8. **DB/domain types don't cross the transport boundary** — the API contract must
   not be `typeof table.$inferSelect`; DTOs and mapping live at the edge (Martin;
   Microsoft; Serban; Stemmler).
9. **Repositories, when used, are domain-shaped, not table-shaped** — ubiquitous-
   language methods, no leaked query builders (Fowler; CodeOpinion; Serban).
10. **Callers own transaction boundaries; repositories receive them** — start
    `db.transaction()` in the application service, pass the typed `tx` handle down
    as an optional parameter (Sentry; Serban; da Silva).
11. **Parse, don't validate — once, at the edge.** Zod at the route boundary
    produces typed values; inner layers accept only those types. Two kinds of
    validation, both mandatory: transport shape (400s) and domain invariants
    (violation = bug = exception) (King; Khorikov; Fastify docs; Collina).
12. **One composition root wires everything**; manual/factory DI is the consensus
    for medium apps — a container earns its keep only at ~dozens of services or
    for per-request scoping/disposal (Ivanov; Practica; fastify-awilix's actual
    differentiator; Palermo part 4: containers are optional tooling).
13. **Fastify decorators are legitimate DI at the delivery layer only** — below it,
    pass dependencies explicitly so they stay visible in signatures.
14. **Test shape follows the architecture: honeycomb, not pyramid** — unit-test the
    pure domain core (no mocks), integration-test through the API with a real
    containerized Postgres, mock only at the system boundary (other people's
    services), tiny E2E (Spotify; Goldberg; Tovslid states the reconciliation).
15. **It's for behavior-rich modules, not everything** — Palermo (not for small
    sites), Microsoft (CRUD can be simpler), Bogard (per-slice choice), Collina
    (full separation is "gargantuan effort" — apply with judgment).

## 10. Genuine disagreements to acknowledge in the skill

- **Repositories over a thin ORM: contested.** Pro camp (Fowler's catalog,
  Stemmler, Serban) vs critique camp (CodeOpinion: an ORM is already a
  repository+UoW). Drizzle sharpens both sides — barely an abstraction to wrap,
  but raw types leak SQL everywhere if unwrapped. Present as a dial: interface
  because an inner layer needs a port ≠ interface because the diagram says so.
- **How many rings.** Palermo has three inner rings; Martin four circles ("the
  number is schematic"); Seemann and Goldberg prefer flatter. Consensus on
  direction, not on count — don't cargo-cult a fixed layer stack.
- **Domain model vs persistence model split can be overkill.** Stemmler's full
  triple-model + mappers vs Fowler's anemic-model warning: if domain objects are
  data bags, Drizzle's inferred types + a service layer (honest transaction
  script) is cheaper and more truthful. The split earns its cost only with real
  behavior/invariants.
- **"Swap the database" is a weak justification** for repositories; the strong
  ones are testability seams and aggregate encapsulation.
- **Transaction propagation:** explicit tx-handle passing (visible, threads a
  parameter) vs AsyncLocalStorage/CLS (clean signatures, implicit, framework-
  coupled). Explicit passing is the more documented Drizzle pattern.
- **Decorators-as-DI vs explicit parameters:** Fastify docs promote decorators;
  the hexagonal/functional camp calls anything reachable via `fastify.x` a service
  locator. Resolution: decorate only at the delivery layer.
- **Maintainer practice vs textbook onion:** the official Fastify demo puts
  business logic in `routes/`, thinner than this repo already is — a codebase with
  a real `adapters/` + container is a deliberate step beyond, not a deviation.
- **Uniform layering vs per-feature choice:** Bogard's vertical slices vs
  app-wide onion; Graça's middle position (components outside, layers inside) is
  the one this repo's `modules/` layout already embodies.
- **No built-in unit of work in Drizzle** — don't promise one beyond a
  transaction-scoped wrapper; MikroORM is the only mainstream TS ORM with native
  UoW.
- **Source-quality gradient:** Palermo, Cockburn, Martin, Fowler, King, Spotify,
  official Fastify/Drizzle/Zod/Testcontainers docs, and Goldberg are canon; the
  Drizzle-specific layering material (Sentry blog, Serban, Medium posts) is
  practical but individually authored and not vetted by the Drizzle team.

## 11. Mapping to this repo (`server/` + `reviewer-core/`)

The backend already implements a proto-onion; the skill's job is to **name the
layers, state the rules, and stop drift** — not to prescribe a migration.

| Onion layer | Where it lives today |
|---|---|
| Domain core | `reviewer-core/src` (review pipeline, grounding, prompts — consumed as source, no Fastify/Drizzle imports) + pure module logic (`helpers.ts`, `findings.ts`) |
| Ports (core-owned interfaces) | `server/src/vendor/shared/adapters.ts` (`LLMProvider`, `GitClient`, `GitHubClient`, `CodeIndex`, `Embedder`, `SecretsProvider`…) + module-level facades (`modules/repo-intel/types.ts` → `RepoIntel`) |
| Application services | `modules/<name>/service.ts` — orchestration, transaction boundaries |
| Infrastructure (driven adapters) | `server/src/adapters/*` (octokit, simple-git, ripgrep, LLM SDKs, tiktoken, dependency-cruiser) + `modules/<name>/repository.ts` (Drizzle) + `adapters/mocks.ts` as the test-double adapter set |
| Transport (driving adapters) | `modules/<name>/routes.ts` — default-export Fastify plugin, zod schemas via `fastify-type-provider-zod`, thin handlers |
| Composition root | `platform/container.ts` (lazy getters, `ContainerOverrides` for tests) + `app.ts` |

Existing conventions the skill must speak to, not fight:
- Module anatomy: `routes.ts` / `service.ts` / `repository.ts` / `helpers.ts` /
  `constants.ts`; simple modules (`polling`, `workspace`) legitimately stay
  routes-only — the Bogard/Microsoft carve-out in practice.
- Cross-module data access goes through the container (`container.agentsRepo`),
  never by reaching into another module's folder (stated in `container.ts`).
- DTO mapping already lives in `helpers.ts` (`toAgentDto`) — name this as the
  boundary-mapping rule.
- Validation is schema-first at routes (per `server/CLAUDE.md`: "Don't hand-roll
  `Schema.parse(req.body)`").
- Test lanes: hermetic unit tests + `*.it.test.ts` integration lane with
  Testcontainers — already the honeycomb shape.
- `platform/` shims re-export from `reviewer-core` ("fix the engine, never the
  shim") — an existing dependency-direction rule to cite.
- `dependency-cruiser` is already a server dependency (as a repo-intel adapter);
  it can double as the mechanical enforcer of import-direction rules
  (services must not import `adapters/*` concretes; `reviewer-core` must not
  import server code; nothing imports `platform/container.ts` except `app.ts`
  and routes).

## 12. Plan for SKILL.md

> **2026-08-05 — superseded in part.** A second pass walked the actual backend
> dependency list and the live import graph. Five tool families the original pass
> never covered (async jobs, the SSE event bus, config/secrets, the LLM SDKs as an
> anti-corruption layer, and mechanical enforcement) are researched in §13; the
> drift they expose is in §14. **The current plan is §15** — the section list
> below is kept as the record of the first pass.

Frontmatter description (draft): "Onion Architecture for the backend
(`server/` + `reviewer-core/`). Use when adding or restructuring a server module,
deciding where business logic / persistence / adapter code lives, defining a new
adapter or port interface, wiring dependencies, placing validation, choosing
transaction boundaries, or deciding what kind of test to write. Structural
decisions only — Fastify mechanics live in `fastify-best-practices`, query idioms
in `drizzle-orm-patterns`, schema idioms in `zod`, physical schema design in
`postgresql-table-design`."

Proposed sections:
1. **Core principles** — the four Palermo tenets restated for this repo; the
   dependency rule as one sentence per layer.
2. **Layer map** — the table from §11, as the normative reference.
3. **Module anatomy** — when a module is routes-only vs full
   routes/service/repository; the promotion trigger (business rules or
   persistence appear → grow the layer, mirroring `frontend-ui-architecture`'s
   promotion ladder).
4. **Thin routes** — parse → call service → map DTO; no `request`/`reply` past
   the handler; response schemas as output allowlist.
5. **Ports & adapters** — new external tool = interface in `vendor/shared` (or
   module `types.ts`) first, implementation in `adapters/`, mock in `mocks.ts`,
   wiring in the container; canonical-copy warning for `vendor/shared`.
6. **Persistence** — repositories domain-shaped; Drizzle types never cross the
   service boundary; DTO mapping in `helpers.ts`; tx-handle passing pattern;
   caller owns the transaction.
7. **Validation** — the two-kinds split (transport zod / domain invariants);
   parse-don't-validate; invariant violation = bug = throw, invalid input = 400.
8. **Dependency injection** — composition root rules; `ContainerOverrides` for
   tests; no DI framework below ~dozens of services; decorators only at delivery.
9. **Testing shape** — honeycomb mapped to the repo's lanes (unit = pure core,
   `*.it.test.ts` = real Postgres, mocks only at the system boundary).
10. **When NOT to layer** — the calibration section (Palermo, Microsoft, Bogard,
    Collina); routes-only modules are legitimate.
11. **Known judgment calls** — condensed from §10.

Follow-ups (not part of SKILL.md itself):
- Optional: a `dependency-cruiser` config enforcing the import-direction rules
  mechanically (mirrors `frontend-ui-architecture`'s "enforce mechanically" rule).
- Register the skill in `.claude/skills/README.md` if that index is maintained.

---

## 13. Second pass (2026-08-05) — the tools we actually run, and their layer role

Compiled from `server/package.json` + `reviewer-core/package.json` and the live
import graph. Every dependency gets a layer verdict; the last column is the source
that governs it. Rows marked **NEW** were not covered by the first pass — their
sources follow the table (all URLs fetched and verified 2026-08-05).

| Backend tool (dependency) | Onion role | Governed by |
|---|---|---|
| `fastify` 5, `@fastify/{helmet,cors,rate-limit}` | driving adapter — transport ring | §3 (Fastify docs, Collina, demo repos) |
| `fastify-type-provider-zod`, `zod` | boundary parser — the ring's outer skin | §6 (King, Khorikov, Zod docs) |
| `drizzle-orm`, `postgres`, `drizzle-kit` | driven adapter — persistence | §5 (Fowler, CodeOpinion, Sentry, Serban) |
| `octokit`, `simple-git`, `@vscode/ripgrep`, `@ast-grep/napi`, `js-tiktoken`, `graphology(-metrics)` | driven adapters behind core-owned ports | §1/§4 (Cockburn, Graça, Breck-McKye) |
| `openai`, `@anthropic-ai/sdk`, OpenRouter | **NEW** — driven adapters behind `LLMProvider`; textbook anti-corruption layer | 13.1 |
| `p-queue` (via `platform/jobs.ts` `JobRunner`) | **NEW** — infrastructure; the *ability to enqueue* is an outbound port, the queue is not domain | 13.2 |
| `fastify-sse-v2` + `node:events` (`platform/sse.ts` `RunBus`) | **NEW** — outbound event/observer port + a *driving* adapter on the read side | 13.3 |
| `dotenv` + `EnvSchema` (`platform/config.ts`), `SecretsProvider` | **NEW** — composition-root concern; config never read below the root | 13.4 |
| `dependency-cruiser` | dual role: a repo-intel driven adapter **and** the mechanical enforcer of the dependency rule | 13.5 |
| `vitest`, `@testcontainers/postgresql`, `testcontainers` | test lanes = honeycomb | §8 |
| `eslint` + `typescript-eslint` (`server/`, added 2026-08-05, no config yet) | second mechanical enforcer — import-boundary rules | 13.5 |
| `@fastify/autoload` | **declared but never imported** — vestigial; registration is static by design (`modules/index.ts:17`) | — |

### 13.1 LLM SDKs as an anti-corruption layer — **NEW**
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html —
  AWS Prescriptive Guidance, the authoritative ACL write-up: "a mediation layer
  that translates domain model semantics from one system to another system."
  Applicability includes, verbatim, "Your application is communicating with an
  external system." Names the real costs too — operational overhead, single point
  of failure (mitigate with retry/circuit-breaker), added latency.
  Related patterns linked from that page (not separately fetched):
  `retry-backoff` and `circuit-breaker` — the pattern names for what
  `platform/resilience.ts` already implements.
- https://codeartify.substack.com/p/ditching-the-dogma-for-pragmatism — the
  counterweight: "Simply inlining the port while adhering to the dependency
  inversion principle can remove such unnecessary indirections." Ports earn their
  keep in exactly two cases — **an external system you do not control** (ACL) and
  **a realistic second implementation**. `LLMProvider` scores on both (three
  providers today), so it is the skill's canonical worked example of a justified
  port; a one-implementation wrapper is the counter-example.
- https://github.com/baabakk/llm-ports — TS reference implementation of the same
  idea (provider registry, fallback chains, cost gating). Individually authored,
  not canon; useful only as shape confirmation for `PriceBook` / `model-router.ts`.

### 13.2 Background jobs & queues — **NEW**
- https://github.com/jasontaylordev/CleanArchitecture/issues/95 and
  https://github.com/jasontaylordev/CleanArchitecture/discussions/395 — the
  most-referenced Clean Architecture reference repo debating exactly this. Rough
  consensus in-thread: the **scheduler/queue is infrastructure**; the application
  layer depends on an abstraction (an `IJobAgent`-style outbound port) and the job
  handler itself is a thin adapter that resolves and invokes a use case.
- Consequence for this repo: `JobRunner` living in `platform/` is correct — it is
  a composition-root service, not module code. The rule to write: **a job handler
  is a driving adapter, exactly like a route** — it may adapt a payload and call a
  service, and it may not hold business rules. `enqueue()` is the port; `PQueue`,
  the timeout, and the retry policy are the adapter's private business.
- Ties to §10's transaction disagreement: the `jobs` table row and the work it
  represents are written in separate statements, so the same atomicity gap as
  §13.3 applies.

### 13.3 Streaming progress / the run event bus — **NEW**
- https://khalilstemmler.com/articles/typescript-domain-driven-design/chain-business-logic-domain-events/ —
  the TS treatment of domain events: events are created in the core, **dispatched
  only after the write commits**, and subscribers live in infrastructure so the
  emitting subdomain never imports them. The layering lesson transfers even though
  `RunBus` carries progress events rather than domain events: the emitter is a
  port, the transport (SSE) is an adapter, and the core never knows who listens.
- https://microservices.io/patterns/data/transactional-outbox.html — Richardson's
  canonical statement of the hazard this repo already lives with: you cannot
  atomically commit a DB write and publish a message, so "store the message in the
  database as part of the transaction that updates the business entities" and relay
  it separately. Cite it as the *named* pattern behind the persist-the-trace-on-
  completion design in `platform/sse.ts` — and as the honest caveat that an
  in-memory `EventEmitter` buffer loses events on crash, by construction.
- Rule this yields: services emit through the injected bus (`container.runBus`);
  only `routes.ts` may touch `reply.sse` / the SSE plugin. Cancellation
  (`RunBus.cancel` + checkpoint polling) is the same shape — a port the core
  *reads*, never a transport concern it handles.

### 13.4 Config & secrets as a composition-root concern — **NEW**
- https://12factor.net/config — "The twelve-factor app stores config in
  environment variables"; strict separation of config from code, and the
  credibility test: the codebase "could be made open source at any moment, without
  compromising any credentials." Backs the existing split — `AppConfig` is parsed
  once from env at boot, secrets never enter it.
- The onion rule on top of 12-factor (Palermo tenet 4 + Goldberg §1.2): env access
  is an *outer-ring* capability. `process.env` may be read in exactly two places —
  `platform/config.ts` and `adapters/secrets/local.ts` (already documented as the
  one chokepoint in `config.ts`'s header comment). Anything below reads its config
  from the object it was handed.

### 13.5 Enforcing the dependency rule mechanically — **NEW**
- https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md —
  `forbidden` rules with `from`/`to` + `path`/`pathNot` regexes; `allowed` rules
  emit `not-in-allowed` for anything unlisted (whitelist mode). Two features matter
  here: **group matching** with back-references —
  `from: '^src/modules/([^/]+)/'`, `to: { path: '^src/modules/([^/]+)/', pathNot: '^src/modules/$1/' }` —
  which expresses "no cross-module imports" in one rule, and `reachable: true`
  for transitive rules.
- https://medium.com/better-programming/validate-dependencies-according-to-clean-architecture-743077ea084c —
  the walkthrough of doing precisely this for a clean-architecture layout.
  Individually authored; useful for the config shape, not as canon.
- Relevance: the binary is **already a `server/` dependency** (used programmatically
  by the depgraph adapter), so wiring `.dependency-cruiser.cjs` costs one config
  file and no new dependency. `eslint` + `typescript-eslint` landed in
  `server/package.json` on 2026-08-05 with no config yet — the two are
  complementary: ESLint bans imports at authoring time, dep-cruiser catches the
  transitive and orphan cases. (This also dates the root INSIGHTS entry
  "No package in this repo has ESLint" — still true of `client/`, no longer of
  `server/`.)

## 14. Drift in the live code the skill must speak to (verified 2026-08-05)

Not a migration plan — the material the skill's rules must be written against, so
each rule points at something real.

1. **Transport reaches straight into persistence in four modules.** `routes.ts` in
   `polling`, `pulls`, `settings`, `workspace` imports `drizzle-orm` *and*
   `db/schema` directly. Evidence: `grep -rln "db/schema" src/modules/*/routes.ts`.
   The existing `server/INSIGHTS.md` entry names `pulls` as "the outlier"; it is
   four of eight modules, so the skill must state the promotion trigger rather than
   treat it as one file's debt.
2. **Services receive the whole `Container`.** `AgentsService`, `ReviewService`,
   `RepoService` all take `constructor(private container: Container)` — a service
   locator one ring below where the Fastify docs sanction it (§9 consensus 13).
   Ivanov's factory-with-a-dependencies-object (§4) is the alternative. This is a
   **judgment call to document, not a violation to declare**: it is type-only
   coupling, it keeps `ContainerOverrides` test injection working, and changing it
   is a wide refactor. The rule to write: a service names the capabilities it uses;
   new services take an explicit deps object.
3. **`adapters/` holds pure functions that services import directly.**
   `reviews/diff-loader.ts` imports `adapters/git/diff-parser.js`;
   `repo-intel/service.ts` imports `adapters/codeindex/extract.js` and
   `adapters/astgrep/index.js`. Under a naive "services must not import
   `adapters/*`" rule these are violations; in truth `parseUnifiedDiff` /
   `extractEndpoints` are pure and misfiled. The skill needs the **test**, not the
   path rule: an adapter is code that talks to something outside the process
   (network, disk, subprocess, clock). Pure transformation belongs in the core even
   if it parses a foreign format.
4. **No `db.transaction()` anywhere** (`server/INSIGHTS.md`, 2026-08-05). §9's
   consensus 10 (caller owns the transaction, repository takes an optional `tx`)
   has no implementation to point at — the skill must mark it as prescriptive and
   show the `insertReview → insertFindings → markReviewed` sequence as the case
   that needs it.
5. **No route declares `schema.response`** (`server/INSIGHTS.md`, 2026-08-05), so
   the output allowlist the transport section will mandate is currently inert.
   Write it as a rule with a known gap, not as a description of practice.
6. **`@fastify/autoload` is declared but never imported.** The skill's "modules are
   registered statically" rule should say so, so nobody re-derives autoloading from
   the dependency list.

## 15. Current plan for SKILL.md (supersedes §12) — **shipped 2026-08-05**

> Implemented as `SKILL.md` v1.0.0 (14 sections, as planned below) + `README.md`
> (the sourced justification). This file stays as the working record: §13's
> tool→layer map and §14's drift list are the material the rules were written
> against, and §10/§14 are where a future revision should start.


Format follows `frontend-ui-architecture`: `SKILL.md` (rules only, ~250 lines) +
`README.md` (the sourced justification, distilled from this file). Frontmatter
description as drafted in §12, plus "…background jobs, streaming/event emission,
config and secrets placement…" in the trigger list.

| § | Section | Core content | Sources |
|---|---|---|---|
| 1 | **Core principles** | Palermo's four tenets restated per-repo; the dependency rule in one line; "package by module, layer inside" | §1, §9.1–5 |
| 2 | **Layer map** | The §11 table, extended with rows for jobs, the run bus, config/secrets | §11, §13 |
| 3 | **Module anatomy & the promotion ladder** | routes-only → +`service.ts` → +`repository.ts`; trigger = a business rule or a second consumer appears; cites drift #1 | §2 (Bogard), §9.15 |
| 4 | **Thin routes** | parse → context → service → DTO; `request`/`reply` never travel inward; response schema as allowlist (with drift #5's gap) | §3, §9.6 |
| 5 | **Ports & adapters** | The **is-it-an-adapter test** (does it leave the process?) settling drift #3; port first in `vendor/shared` or module `types.ts`, impl in `adapters/`, mock in `mocks.ts`, wire in container; canonical-copy warning; ports earn their keep only via ACL-or-second-impl | §1, §13.1 |
| 6 | **Persistence** | Domain-shaped repositories; Drizzle row types stop at the service boundary; DTO mapping in `helpers.ts`; caller owns the transaction and passes `tx` down (drift #4) | §5, §9.8–10 |
| 7 | **Validation** | parse-don't-validate at the edge; transport invalid = 4xx, invariant violation = bug = throw | §6, §9.11 |
| 8 | **Config & secrets** | Two legal `process.env` readers; `AppConfig` parsed once at boot; secrets only via `SecretsProvider`; never below the composition root | §13.4 |
| 9 | **Dependency injection** | One composition root; `ContainerOverrides` for tests; explicit deps for new services (drift #2); decorators only at the delivery ring; no DI framework at this size | §4, §9.12–13 |
| 10 | **Async work: jobs, queues, streams** | A job handler is a driving adapter; `enqueue` is a port; services emit via the injected bus, only routes touch SSE; cancellation is a checkpoint the core reads; the in-memory-buffer caveat | §13.2, §13.3 |
| 11 | **Testing shape** | Honeycomb → the repo's two lanes; pure core needs no mocks; `*.it.test.ts` with real Postgres; fake other people's services only | §8, §9.14 |
| 12 | **When NOT to layer** | Calibration: small modules stay routes-only; anemic model warning; "gargantuan effort" caveat | §2, §9.15, §10 |
| 13 | **Enforcement** | Proposed `.dependency-cruiser.cjs` rule set (below) + ESLint import bans once `server/eslint.config.js` exists | §13.5 |
| 14 | **Known judgment calls** | Condensed §10 + drift #2 and #3 as live examples | §10, §14 |

Rule set section 13 will ship (as a copy-pasteable block, not a committed config):
- `reviewer-core` must not import `server/src` — the purity contract, mechanised.
- `modules/*/routes.ts` must not import `db/schema` or `drizzle-orm` (drift #1).
- `modules/*` must not import another module's folder — the group-match rule from
  §13.5, with `_shared/` and the container as the sanctioned crossings.
- Only `app.ts`, `modules/*/routes.ts`, and `modules/*/service.ts` may import
  `platform/container.js`.
- Nothing outside `platform/config.ts` and `adapters/secrets/*` may read
  `process.env`.
- `platform/prompt|grounding|structured.ts` importable, never editable — pair the
  rule with the "fix the engine, never the shim" note.

Follow-ups unchanged from §12 (register in `.claude/skills/README.md`), plus:
- Decide whether the dep-cruiser config lands as part of the skill or as a
  separate `server/` change — the skill can ship the rules as documentation first.
