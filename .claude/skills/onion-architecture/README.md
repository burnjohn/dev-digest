# onion-architecture — sources

All sources behind [SKILL.md](SKILL.md). Compiled from four research passes: the
Onion/Hexagonal/Clean canon (2026-08-04) · Fastify layering and dependency
injection (2026-08-04) · persistence, validation and testing (2026-08-04) · the
tool-by-tool audit of this backend's actual dependency list (2026-08-05). URLs
were fetched and verified to resolve at research time; the full raw notes,
including the per-tool layer map and the drift this skill was written against,
are in [SOURCES.md](SOURCES.md).

**Version 1.0.0** (2026-08-05) — initial release.

## The canon — Onion, Hexagonal, Clean

- [The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) · [part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) · [part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — Jeffrey Palermo (2008), the post that coined the term: "code can depend on layers more central, but code cannot depend on layers further out from the core"; the four tenets; repository interfaces in the core; "the database is not the center. It is external." Explicitly **not for small websites**.
- [Onion Architecture: Part 4 — After Four Years](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/) — Palermo (2013): tenets unchanged; corrects the top misconception — DI containers are optional tooling, not part of the pattern.
- [Hexagonal Architecture (Ports and Adapters)](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn: the app "equally driven by users, programs, automated test or batch scripts"; primary/driving vs secondary/driven ports.
- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — Robert C. Martin (2012): the Dependency Rule ("source code dependencies can only point inwards"); "isolated, simple, data structures are passed across the boundaries" — the justification for DTOs at the edge.
- [Layers, Onions, Ports, Adapters: it's all the same](https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/) — Mark Seemann (2013): applying DIP to a layered diagram mechanically produces the onion; prefers flatter hierarchies — the caution against over-layering.
- [Explicit Architecture: DDD, Hexagonal, Onion, Clean, CQRS](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — Herberto Graça (2017), the best single synthesis: "a port is nothing more than a specification" and it **belongs inside the core**; advocates package-by-component over package-by-layer.

## Applying it — layers, model richness, the critique

- [Designing a DDD-oriented microservice](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice) — Microsoft .NET architecture docs: Domain depends on nothing (persistence ignorance); entities never reach the presentation layer; and the caveat that this layering "should be applied only if you are implementing complex microservices with significant business rules."
- [AnemicDomainModel](https://martinfowler.com/bliki/AnemicDomainModel.html) — Martin Fowler (2003): anemic models "incur all of the costs of a domain model, without yielding any of the benefits."
- [How to Organize Your App's Logic](https://khalilstemmler.com/articles/software-design-architecture/organizing-app-logic/) — Khalil Stemmler: the Node/TS layer map (domain → application → adapters/infrastructure) and the stability argument. Companions: [use cases](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/application-layer-use-cases/) · [DTOs, mappers, repositories](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) · [ddd-forum reference repo](https://github.com/stemmlerjs/ddd-forum). The **maximal** end of the TS spectrum — read alongside the calibration sources.
- [Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) — Jimmy Bogard (2018), the respected critique: rigid controller→service→repository chains abstract "things that really shouldn't be abstracted"; "minimize coupling between slices, maximize coupling in a slice."
- [Ports & Adapters-Style Architectures: Ditching the Dogma for Pragmatism](https://codeartify.substack.com/p/ditching-the-dogma-for-pragmatism) — the two-case test for whether a port earns its keep (external system you don't control, or a realistic second implementation); "simply inlining the port while adhering to the dependency inversion principle can remove such unnecessary indirections."

## Fastify — official structure and maintainer practice

- [Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) · [Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) · [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) · [Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) — the encapsulation context as the structuring primitive; decorators as a scoped service locator; validation as a route-boundary concern compiled at boot; response schemas as an output allowlist that "prevents accidental disclosure of sensitive data."
- [fastify/demo](https://github.com/fastify/demo) — the org's reference app: `plugins/` split into `external/` and `app/`, `routes/` by feature, separate `app.ts` / `server.ts`.
- [delvedor/fastify-example](https://github.com/delvedor/fastify-example) — a Fastify co-creator: "two top level folders, `plugins` and `routes`." Together with the demo, the honest baseline — the Fastify org demonstrates *less* layering than this repo has.
- [Building a Modular Monolith with Fastify](https://gitnation.com/contents/building-a-modular-monolith-with-fastify) — Matteo Collina (Node Congress 2023): MVC "doesn't scale well in complexity" — structure by domain; "an API is a contract between people"; full transport/domain separation is a "gargantuan effort."
- [Accelerating Server-Side Development with Fastify](https://backend.cafe/the-fastify-book-is-out) — Spigolon, Sinik & Collina (Packt 2023), the closest thing to an official structuring manual.
- [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) — one zod schema at the boundary doing runtime validation and static handler typing; already this repo's validation mechanism.

## Node layering & dependency injection

- [Node.js Best Practices §1.2 — layer your components](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/createlayers.md) — Yoni Goldberg et al.: entry-points → domain → data-access, three flat layers as the sweet spot, and the hard rule that framework objects (`req`/`res`) never enter the domain layer.
- [practica.js](https://github.com/practicajs/practica) — the same advice applied to Fastify concretely: "simple functions calling other functions."
- [Functional ports-and-adapters in TypeScript](https://github.com/jbreckmckye/node-typescript-architecture) — Jamie Breck-McKye: hexagonal with no classes and no container; ports are plain interfaces, domain functions receive them as arguments.
- [Dependency Injection in Node.js & TypeScript](https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you) — Petar Ivanov (2026): DI is a testability play; `vi.mock()`-based testing is brittle; factory functions taking a dependencies object plus one composition root; adopt a container only at ~20–30+ services, "not because it's 'proper'."
- [@fastify/awilix](https://github.com/fastify/fastify-awilix) and [the issue that spawned it](https://github.com/fastify/fastify/issues/2587) — containers are sanctioned but opt-in; the real differentiators are per-request scoping and disposal.

## Data layer — repositories, Drizzle, transactions

- [Repository — P of EAA catalog](https://martinfowler.com/eaaCatalog/repository.html) — Hieatt & Mee: "mediates between the domain and data mapping layers using a collection-like interface."
- [Drizzle overview](https://orm.drizzle.team/docs/overview) and [maintainer discussion #232](https://github.com/drizzle-team/drizzle-orm/discussions/232) — a deliberately thin "headless ORM" that makes **no architectural recommendations**; the maintainer's position is that Drizzle "leaves abstraction patterns to users." Bring your own architecture.
- [Avoiding the Repository Pattern with an ORM](https://codeopinion.com/avoiding-the-repository-pattern-with-an-orm/) — Derek Comartin (2019), the pragmatic critique: an ORM context is already a repository + unit of work; repositories still earn their keep for aggregate roots and genuinely swappable implementations.
- [Atomic repositories in clean architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) — Lazar Nikolov (Sentry, 2024): repositories take an **optional transaction parameter** typed via Drizzle's `Transaction`; the caller starts `db.transaction()` and passes the handle down.
- [Drizzle ORM best practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) — Paul Serban: repositories express business operations, not table operations; no `beginTransaction` on a repository.
- [Transactions with DDD and the repository pattern in TypeScript](https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901) — the explicit unit-of-work treatment for Drizzle, honest about where it leaks. · [Repository pattern in NestJS with Drizzle](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae) — documents the competing AsyncLocalStorage/CLS propagation style. Both individually authored, not vetted by the Drizzle team.

## Validation — parse, don't validate

- [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King (2019): parsing "consumes less-structured input and produces more-structured output"; names shotgun parsing as a correctness and security hazard.
- [Zod basics](https://zod.dev/basics) · [Zod API — branded types](https://zod.dev/api) — `safeParse` at boundaries, `z.infer` as the single source of truth for DTO types; branding as a static-only construct ("branded types do not affect the runtime result of `.parse`").
- [Always-Valid Domain Model](https://enterprisecraftsmanship.com/posts/always-valid-domain-model/) — Vladimir Khorikov (2021), the canonical two-kinds-of-validation split: boundary validation filters untrusted input (not exceptional — model as a result/4xx); a domain invariant violation is a **bug** and warrants an exception. Companion: [validation vs invariants](https://khorikov.org/posts/2022-06-06-validation-vs-invariants/).
- [Four essential TypeScript patterns](https://www.totaltypescript.com/four-essential-typescript-patterns) — Matt Pocock: branded types as validation boundaries when the core shouldn't import zod.

## Functional core, imperative shell

- [Boundaries](https://www.destroyallsoftware.com/talks/boundaries) — Gary Bernhardt (SCNA 2012), the origin; simple values as boundaries between subsystems.
- [Functional Core, Imperative Shell](https://kennethlange.com/functional-core-imperative-shell/) — Kenneth Lange: the core cannot call the shell or even know it exists — the same rule as the onion, stated for functions instead of classes.
- [FCIS in JavaScript](https://medium.com/@magnusjt/functional-core-imperative-shell-in-javascript-29bef2353ac2) — Magnus Tovslid (2019): the pure core needs zero mocks and the thin shell is covered by integration tests — the bridge from FCIS to the testing shape below.

## Testing a layered backend

- [Testing of Microservices](https://engineering.atspotify.com/2018/01/testing-of-microservices) — Spotify Engineering (2018), the honeycomb: many integration tests through real contracts, few implementation-detail unit tests; "the interesting complexity is at the boundaries."
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodejs-testing-best-practices/blob/master/README.md) — Yoni Goldberg: "the first tests to write should be component tests"; use the same DB product as production via containers, never mock the DB; fake other people's services, not your own code.
- [Testcontainers for Node.js](https://node.testcontainers.org/) — throwaway real Postgres per suite; already this repo's `*.it.test.ts` lane.

## The tools this backend actually runs (2026-08-05 pass)

- [Anti-corruption layer pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/acl.html) — AWS Prescriptive Guidance: "a mediation layer that translates domain model semantics from one system to another system," applicable when "your application is communicating with an external system." Names the costs too — operational overhead, single point of failure, latency. The pattern behind `LLMProvider` and the octokit/simple-git adapters; its linked [retry with backoff](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html) and [circuit breaker](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/circuit-breaker.html) patterns are what `platform/resilience.ts` implements.
- [llm-ports](https://github.com/baabakk/llm-ports) — a TS multi-provider LLM abstraction (registry, fallback chains, cost gating). Individually authored; shape confirmation for `model-router.ts` / `PriceBook`, not canon.
- [CleanArchitecture — background jobs discussion](https://github.com/jasontaylordev/CleanArchitecture/discussions/395) and [worker service issue](https://github.com/jasontaylordev/CleanArchitecture/issues/95) — the most-referenced Clean Architecture reference repo on where a scheduler lives: the queue is infrastructure, the application layer depends on an enqueue abstraction, and the handler is a thin adapter that invokes a use case.
- [Chaining business logic with domain events](https://khalilstemmler.com/articles/typescript-domain-driven-design/chain-business-logic-domain-events/) — Stemmler: events dispatched only after the write commits; subscribers live in infrastructure so the emitting module never imports them.
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) — Chris Richardson: you cannot atomically commit a write and publish a message, so "store the message in the database as part of the transaction that updates the business entities." The named pattern behind persisting the run trace on completion — and the honest limit of an in-memory event buffer.
- [The Twelve-Factor App — III. Config](https://12factor.net/config) — "the twelve-factor app stores config in environment variables"; the credibility test is that the codebase could be open-sourced at any moment without compromising credentials.
- [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) — `forbidden` vs `allowed` rules, `from`/`to` with `path`/`pathNot`, group matching with `$1` back-references (the one-rule expression of "no cross-module imports"), and `reachable: true` for transitive rules.
- [Validate dependencies according to Clean Architecture](https://medium.com/better-programming/validate-dependencies-according-to-clean-architecture-743077ea084c) — a walkthrough of doing exactly that with dependency-cruiser. Individually authored; useful for config shape.

## Changelog

- **1.0.0** (2026-08-05) — initial release: distilled from the four research passes in [SOURCES.md](SOURCES.md); scoped to complement `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, and `postgresql-table-design`, and to mirror `frontend-ui-architecture` on the backend.
