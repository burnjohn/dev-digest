# Layers and the Dependency Rule

## Origin

Jeffrey Palermo coined "Onion Architecture" in 2008 to fix a specific problem in
traditional N-tier/layered designs: the "business logic" layer usually ended up
depending directly on the database layer, which meant the domain couldn't be tested
or evolved without dragging infrastructure along. His fix: draw the architecture as
concentric rings instead of a stack, with one absolute rule — **code can depend on
layers more central to it, but never on layers further out.**

- [The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
- [The Onion Architecture, part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/)
- [The Onion Architecture, part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/)

## The rings

1. **Domain model / domain services** (center) — entities and business rules with
   zero knowledge of databases, HTTP, or any framework.
2. **Application services** — orchestrate domain objects to fulfill a use case; this
   is where transactions, workflows, and coordination across repositories live.
3. **Infrastructure / presentation** (outer ring) — UI, HTTP controllers, database
   access, external API clients, message queues. Everything that talks to the
   outside world.

The database is an outer-ring detail, on equal footing with the UI — both are
plugins to the domain, not the foundation it sits on. Rather than the domain
directly calling a database, the domain (or the application layer just outside it)
defines an **interface** describing what it needs, and infrastructure provides the
concrete implementation. This is dependency inversion (the "D" in SOLID) applied at
the architecture level.

## Onion vs. Hexagonal vs. Clean Architecture

These three are close relatives, not competitors — all three are dependency-inversion-based:

- **Hexagonal (Ports & Adapters)** — Alistair Cockburn, 2005. The core application is
  a hexagon surrounded by *ports* (interfaces) and *adapters* (implementations). It
  doesn't prescribe internal structure of the core.
- **Onion Architecture** — Jeffrey Palermo, 2008. Adds explicit internal rings (domain
  model → domain services → application services) inside the same ports-and-adapters
  shape, borrowing structure from Domain-Driven Design.
- **Clean Architecture** — Robert C. Martin, 2012. Same dependency rule, different
  vocabulary: "entities" (domain), "use cases" (application), "interface adapters" /
  "frameworks & drivers" (infrastructure). Clean Architecture is usually credited with
  drawing clearer boundaries and the "use case" as an explicit unit.

- [Onion vs Clean vs Hexagonal Architecture](https://medium.com/@edamtoft/onion-vs-clean-vs-hexagonal-architecture-9ad94a27da91)
- [DDD, Hexagonal, Onion, Clean, CQRS... How I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — the clearest single explanation of how the three relate and where DDD's own layering fits in.

DevDigest doesn't need to pick a strict lineage; the practical takeaway is the same
in all three: **domain code has zero outward dependencies; everything that touches
the outside world sits behind an interface the domain/application layer owns.**

## Vertical slices

DevDigest is not organized as global `controllers/`, `services/`, `repositories/`
folders. `server/src/modules/index.ts` states the intent directly: "One feature = one
`src/modules/<name>/` plugin." That's a **vertical slice** organization — each
feature owns its full stack of files.

Onion Architecture doesn't require flat horizontal layers; it's equally valid, and
often preferable in a modular monolith, to apply the same inward-dependency rule
*within* each vertical slice. DevDigest already does this: each module's own
`routes.ts → service.ts → repository.ts` is a miniature onion, and cross-cutting
infrastructure (`server/src/adapters/`, `server/src/platform/`) plays the role of the
shared outer ring/ports layer that every slice's `service.ts` depends on through the
DI container.

- [Architectures in Comparison: Onion or Vertical Slice?](https://www.csa.ch/en/blog/architectures-in-comparison-onion-or-vertical-slice)
- [Using Vertical Slice Architecture · modular-monolith-with-ddd discussion](https://github.com/kgrzybek/modular-monolith-with-ddd/discussions/225) — combining vertical slices with onion/layered structure *inside* each slice

## Node.js / TypeScript specifics

- [Implementing the Onion Architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — the canonical Node/TS walkthrough; DevDigest doesn't use InversifyJS (it has its own lightweight DI container at `server/src/platform/container.ts`), but the layer/interface split described is the same shape.
