---
name: onion-architecture
description: >
  Onion Architecture enforcement for the DevDigest backend: Fastify 5, Drizzle ORM, Zod, TypeScript.
  Defines the four concentric layers (Domain, Application, Infrastructure, Presentation), the inward-only
  dependency rule, and how each tool maps to a layer.
  TRIGGER when: adding a new backend module, touching routes.ts / service.ts / repository.ts,
  "where does X go", "what layer", "can I import", adding new adapter, touching container.ts,
  service directly queries DB, route handler contains business logic, Drizzle schema imported in service.
  Does NOT cover: Fastify plugin API details (use fastify-best-practices), Drizzle query syntax
  (use drizzle-orm-patterns), Zod schema syntax (use zod), PostgreSQL schema design (use postgresql-table-design).
---

# Onion Architecture

> **Dependencies point inward. The domain knows nothing about the outside world.**

This skill enforces four concentric layers for every backend module in `server/src/modules/`. It answers "where does this code go?" and "can this file import from that file?" — not "how do I write this Drizzle query?" or "how does Fastify's plugin system work?".

## When to invoke this skill

- Adding or scaffolding a new `modules/<name>/` directory
- Deciding where business logic, a Zod schema, or a Drizzle query belongs
- A service method calls `this.container.db.select()` directly
- A route handler builds domain objects or calls repositories
- A repository imports from another module's service
- Unsure whether a new file is `service.ts`, `repository.ts`, or a helper
- Adding a new external adapter (LLM, GitHub, Git, etc.)
- Touching `src/platform/container.ts`

## Related skills

| Skill | What it covers (NOT this skill) |
|---|---|
| `fastify-best-practices` | Plugin API, decorators, lifecycle hooks, serialization, SSE |
| `drizzle-orm-patterns` | Query builder syntax, relations, migrations, transactions |
| `zod` | Schema definition, safeParse, z.infer, coerce |
| `postgresql-table-design` | Table design, indexes, constraints, pgvector |

## Reading paths

- **New module** → [layers](rules/layers.md) → [presentation-layer](rules/presentation-layer.md) → [application-layer](rules/application-layer.md) → [infrastructure-layer](rules/infrastructure-layer.md)
- **"Where does this go?"** → [dependency-rule](rules/dependency-rule.md) → [layers](rules/layers.md)
- **"Where does validation go?"** → [validation-stack](rules/validation-stack.md)
- **DI / adapters** → [di-container](rules/di-container.md)
- **Domain entities / errors** → [domain-layer](rules/domain-layer.md)

---

## Quick Decision Trees

### Where does this code belong?

```
Does it describe a business concept with invariants (entity, domain error)?
├── YES → domain-layer  (vendor/shared/contracts/ or domain entities)
└── NO
    Does it orchestrate a workflow — combining repo + adapter calls?
    ├── YES → application-layer  (modules/*/service.ts)
    └── NO
        Does it talk to the DB, GitHub, LLM, Git, or any I/O?
        ├── YES → infrastructure-layer  (modules/*/repository.ts or adapters/)
        └── NO (HTTP shape, Fastify handler) → presentation-layer  (modules/*/routes.ts)
```

### Can this file import from that file?

```
I'm in...                 Can I import from...
──────────────────────────────────────────────────
domain/                   → NOTHING outside domain
service.ts (application)  → domain only (no DB, no Fastify)
repository.ts (infra)     → domain + drizzle-orm + db/schema
routes.ts (presentation)  → service.ts + Zod HTTP schemas only
container.ts              → everything (composition root)
```

### Where does this Zod schema go?

```
Does it validate HTTP request/response shape (params, body, reply)?
├── YES → top of routes.ts  or  _shared/schemas.ts  (presentation layer)
└── NO
    Does it check application-level preconditions in a service method?
    ├── YES → z.safeParse() inline in service.ts  (application layer)
    └── NO (domain invariant)
        → plain guard clause:  if (!valid) throw new AppError(...)
           (domain layer — NO Zod import)
```

### New module scaffold

```
modules/<name>/
├── routes.ts        ← Fastify plugin: validate → service call → reply
├── service.ts       ← Orchestration: no SQL, no adapter instantiation
├── repository.ts    ← Drizzle queries: toDomain() + toDb() mappers
├── helpers.ts       ← Pure transforms, DTO converters (optional)
└── constants.ts     ← String/number literals (optional)
```

---

## Core Principles

1. **Inward-only dependencies** — `routes.ts` can import `service.ts`; `service.ts` can NEVER import `routes.ts`. Violations break testability and create circular dependencies.

2. **Domain knows nothing** — `vendor/shared/contracts/` and domain entities have zero imports from Fastify, Drizzle, Zod, or any adapter. If you need to add one, the code belongs in a different layer.

3. **One composition root** — all `new ConcreteClass()` calls live exclusively in `src/platform/container.ts`. Services receive a `Container` and pull what they need. Instantiating adapters in service constructors (e.g., `new OpenAIProvider()`) is forbidden.

4. **Drizzle stays in infrastructure** — `$inferSelect` and `$inferInsert` types never leave the repository file. Services and routes work with DTO types defined in `vendor/shared/contracts/`.

5. **Thin routes** — Fastify handlers do exactly three things: (1) validate input with Zod, (2) call one service method, (3) send the reply. Business rules, branching logic, and DB queries in routes are violations.

6. **Validation is a stack** — every layer validates what it owns. See [validation-stack](rules/validation-stack.md). Never duplicate validation across layers.

---

## Rules Reference

| File | What it covers |
|---|---|
| [rules/layers.md](rules/layers.md) | Four-layer model, project folder mapping, what belongs in each |
| [rules/dependency-rule.md](rules/dependency-rule.md) | Import allow-list per layer, violation examples |
| [rules/domain-layer.md](rules/domain-layer.md) | Entities, domain errors, invariant guards, what NOT to import |
| [rules/application-layer.md](rules/application-layer.md) | Service pattern, orchestration rules, fire-and-forget |
| [rules/infrastructure-layer.md](rules/infrastructure-layer.md) | Repository pattern, data mappers, adapter placement |
| [rules/presentation-layer.md](rules/presentation-layer.md) | Fastify route rules, HTTP Zod schemas, error propagation |
| [rules/validation-stack.md](rules/validation-stack.md) | Where each validation type lives across all four layers |
| [rules/di-container.md](rules/di-container.md) | Container pattern, composition root, test doubles |

## Sources

All 13 research URLs → [references.md](references.md)
