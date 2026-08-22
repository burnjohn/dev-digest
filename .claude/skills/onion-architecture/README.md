# onion-architecture — provenance & sources

A local, hand-authored skill (not pulled from a registry — it is not in `skills-lock.json`).
It encodes the onion / ports-and-adapters layering the DevDigest backend already follows and
ships a `dependency-cruiser` gate to enforce it.

- **Scope:** `server/` (Fastify + Drizzle + Postgres) and `reviewer-core/` (pure domain core).
- **Out of scope:** `client/` frontend → use `frontend-architecture` / `react-best-practices`.
- **Grounded in:** `server/AGENTS.md`, `server/README.md`, `server/INSIGHTS.md`,
  `reviewer-core/AGENTS.md`, `server/src/platform/container.ts`,
  `server/src/vendor/shared/adapters.ts`, `server/tsconfig.json`.

## Reading list (the practices this skill distills)

### Onion / Clean architecture (canon)
- Jeffrey Palermo — The Onion Architecture: part 1 — https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Jeffrey Palermo — onion-architecture tag (parts 2–4) — https://jeffreypalermo.com/tag/onion-architecture/
- Herberto Graça — Onion Architecture (Software Architecture Chronicles) — https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85
- Robert C. Martin (Uncle Bob) — The Clean Architecture — https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Original Palermo example (repo) — https://github.com/Jordiag/Jeffrey-Palermo-Onion-Architecture

### Ports & Adapters in Node.js / TypeScript
- Domain-Driven Hexagon (Sairyss) — https://dev.to/sairyss/domain-driven-hexagon-18g5
- Khalil Stemmler — Clean Node.js Architecture — https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/
- Hexagonal & Clean Architecture with examples (dyarleniber) — https://dev.to/dyarleniber/hexagonal-architecture-and-clean-architecture-with-examples-48oi
- Ports and Adapters explained with two real codebases (Saad Hasan) — https://saadh393.github.io/blog/adapter-port-architecture-two-cases
- Future-Proof Your Code: Ports & Adapters (Alex Rusin) — https://blog.alexrusin.com/future-proof-your-code-a-guide-to-ports-adapters-hexagonal-architecture/
- tsh.io — Hexagonal architecture overview & best practices — https://tsh.io/blog/hexagonal-architecture

### dependency-cruiser (forcing the boundaries)
- dependency-cruiser — npm — https://www.npmjs.com/package/dependency-cruiser
- Validate Dependencies According to Clean Architecture (Ken Miyashita) — https://betterprogramming.pub/validate-dependencies-according-to-clean-architecture-743077ea084c
- Avoid Cross Module Dependencies with Dependency Cruiser — https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b
- Dependency Cruiser: Restrict Imports in JavaScript (Atomic Object) — https://spin.atomicobject.com/dependency-cruiser-imports/
- cubic — maintain clean architecture with dependency rules — https://www.cubic.dev/blog/how-to-maintain-clean-architecture-with-dependency-rules-in-your-codebase

### Fastify (layering / encapsulation)
- Fastify — Plugins Guide — https://fastify.dev/docs/latest/Guides/Plugins-Guide/
- Fastify — Encapsulation — https://fastify.dev/docs/latest/Reference/Encapsulation/
- Build Production-Ready APIs with Fastify (Strapi) — https://strapi.io/blog/build-production-ready-apis-with-fastify
- node-fastify-architecture (modular structure) — https://github.com/sujeet-agrahari/node-fastify-architecture

### Drizzle ORM / Repository pattern
- Repository Pattern in Nest.js with Drizzle ORM — https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae
- Atomic Repositories in Clean Architecture and TypeScript (Sentry) — https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/
- cosmicpython — Repository Pattern — https://www.cosmicpython.com/book/chapter_02_repository
- Microsoft Learn — infrastructure persistence layer design — https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design

## Files

- `SKILL.md` — the one rule, the ring diagram, the decision framework, the "add a dependency" recipe.
- `layer-map.md` — every ring mapped to real files + tool→adapter→port table + a "where does it go?" cheatsheet.
- `enforcement.md` — the `.dependency-cruiser.cjs` config, npm scripts, severity rationale, and the exception ledger.
