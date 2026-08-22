# References

All research sources used to build this skill. Organized by topic.

---

## Onion / Clean Architecture — Foundations

| Source | URL | What it covers |
|---|---|---|
| Implementing Onion Architecture in Node.js with TypeScript & InversifyJS | https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad | The canonical Node.js onion article: 4-layer model, SOLID foundations, decorator-based DI. Referenced by most subsequent articles. |
| Onion Architecture in Node.js with TypeScript (Sankhadip Samanta) | https://sankhadip.medium.com/onion-architecture-in-node-js-with-typescript-5508612a4391 | Hands-on implementation with DA/Service/Routes/Types split, IDBManager interface pattern, practical code examples. |
| Future-Proof Your Code: Ports & Adapters Architecture (Alex Rusin) | https://blog.alexrusin.com/future-proof-your-code-a-guide-to-ports-adapters-hexagonal-architecture/ | TypeScript `interface IMailer` as port, `MailtrapMailer implements IMailer` as adapter, constructor injection into use cases. Hexagonal/Ports&Adapters variant. |
| Clean Architecture: Repository Pattern with TypeScript (Alex Rusin) | https://blog.alexrusin.com/clean-architecture-in-node-js-implementing-the-repository-pattern-with-typescript-and-prisma/ | Repository interfaces in domain layer, mixin-based concrete implementations, swapping Prisma for another ORM with zero controller changes. |

---

## Fastify — Architecture Integration

| Source | URL | What it covers |
|---|---|---|
| fastify-boilerplate — Fastify 5 + Clean Architecture + CQRS (marcoturi) | https://github.com/marcoturi/fastify-boilerplate | Production-grade Fastify 5 boilerplate: vertical slices, CQRS command/query bus, thin routes, explicit layer boundary. Best reference for Fastify + Clean Architecture. |
| clean-architecture-fastify-mongodb (borjatur) | https://github.com/borjatur/clean-architecture-fastify-mongodb | Clean architecture template: `core/` (entities, interfaces, use-cases) vs `infrastructure/` (routes, controllers, DB). Mongo but patterns apply. |
| Fastify Plugins as DI Building Blocks (Snyk) | https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/ | How Fastify's plugin/decorate system is a built-in lightweight DI mechanism; thin routes via `fastify.decorate()`. |
| fastify-awilix — Official Fastify DI Container | https://github.com/fastify/fastify-awilix | `diContainer` (app-scoped singletons) + `diScope` (request-scoped), TypeScript module augmentation for type-safe `.resolve()`. Alternative to manual Container pattern. |

---

## Drizzle ORM — Repository & Data Mapper

| Source | URL | What it covers |
|---|---|---|
| Repository Pattern in NestJS with Drizzle ORM | https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae | Full Drizzle repository pattern: schema in infra layer, injectable repository classes, transaction handling via async local storage. NestJS DI maps 1:1 to manual container. |
| Transactions with DDD and Repository Pattern in TypeScript (Drizzle) | https://medium.com/@joaojbs199/transactions-with-ddd-and-repository-pattern-in-typescript-a-guide-to-good-implementation-part-2-da0af3e10901 | DDD + Drizzle: Unit of Work pattern, passing `tx` object through repository methods, keeping domain clean of ORM types. |

---

## Validation Strategy

| Source | URL | What it covers |
|---|---|---|
| Where To Put Validation in Clean Architecture (Michael Maurice) | https://medium.com/@michaelmaurice410/where-to-put-validation-in-clean-architecture-so-its-obvious-fast-and-never-leaks-161bfd62f1dc | Validation stack model: each layer guards what it owns — transport → application → domain → DB constraints. Concrete examples for each layer. |
| Where to put validation in Clean Architecture (ikenox.info) | https://ikenox.info/blog/where-to-put-validation-in-clean-architecture/ | Deep-dive on why wrong-layer validation breaks data restoration; domain invariants vs application constraints vs protocol checks. The most thorough treatment of this topic. |

---

## Dependency Injection

| Source | URL | What it covers |
|---|---|---|
| Dependency Injection in Node.js & TypeScript: The Part Nobody Teaches You | https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you | Manual DI via factory functions, composition root pattern, why `vi.mock('./SomeService')` is a code smell, when containers become necessary. |
