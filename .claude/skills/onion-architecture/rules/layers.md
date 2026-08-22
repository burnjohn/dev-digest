# Layers

The four concentric layers, from innermost to outermost. Each layer can only depend on layers closer to the center.

```
┌─────────────────────────────────────────────────┐
│  Presentation  (routes.ts)                      │
│  ┌───────────────────────────────────────────┐  │
│  │  Infrastructure  (repository.ts, adapters)│  │
│  │  ┌─────────────────────────────────────┐  │  │
│  │  │  Application  (service.ts)          │  │  │
│  │  │  ┌───────────────────────────────┐  │  │  │
│  │  │  │  Domain  (contracts, entities)│  │  │  │
│  │  │  └───────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Layer → Project Folder Mapping

| Onion Layer | Project Location | Key Files |
|---|---|---|
| **Domain** | `src/vendor/shared/contracts/` | `platform.ts`, `findings.ts`, `trace.ts` — pure types, no ORM, no framework |
| **Application** | `src/modules/*/service.ts` | `ReviewService`, `AgentsService`, `ReposService` |
| **Infrastructure** | `src/modules/*/repository.ts`, `src/adapters/` | Drizzle queries, GitHub, LLM, Git, Code Index |
| **Presentation** | `src/modules/*/routes.ts` | Fastify plugin handlers, HTTP Zod schemas |
| *(Cross-cutting)* | `src/platform/` | `container.ts`, `errors.ts`, `sse.ts`, `jobs.ts` — shared utilities |

---

## Domain Layer

**What belongs here:**
- Pure TypeScript types and interfaces (the `contracts/` files)
- Entity classes with invariant guards
- Domain error types (extend `AppError` from `platform/errors.ts`)
- Domain service functions (pure computation, no I/O)

**What is FORBIDDEN here:**
```typescript
// ❌ NEVER in domain layer
import { eq, and } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Container } from '../../platform/container';
```

**Example — domain type (correct):**
```typescript
// vendor/shared/contracts/findings.ts
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  file?: string;
  line?: number;
}
```

---

## Application Layer

**What belongs here:**
- Orchestration: calling repos + adapters in sequence
- Background job dispatch (fire-and-forget)
- Application-level precondition checks (`z.safeParse()` or guard clauses)
- DTO assembly: mapping repo results to contract types

**What is FORBIDDEN here:**
```typescript
// ❌ NEVER in service.ts
this.container.db.select().from(t.repos)...   // Direct DB call — belongs in repository
new OpenAIProvider(apiKey)                     // Adapter instantiation — belongs in container
reply.send({ ... })                            // HTTP knowledge — belongs in routes
import { FastifyRequest } from 'fastify'
```

---

## Infrastructure Layer

**What belongs here:**
- Drizzle queries (`select`, `insert`, `update`, `delete`)
- Data mappers: `toDomain()` and `toDb()` conversion methods
- Adapter implementations (`src/adapters/llm/`, `src/adapters/github/`, etc.)
- External I/O: HTTP clients, file system, process execution

**What is FORBIDDEN here:**
```typescript
// ❌ NEVER in repository.ts
import { ReviewService } from './service'   // Importing from application layer
reply.send({ ... })                         // HTTP knowledge
```

---

## Presentation Layer

**What belongs here:**
- Fastify route plugin registration
- Zod schemas for HTTP request/response shapes
- `getContext(container, req)` call — workspace + user extraction
- `reply.send()` / `reply.status()` calls

**What is FORBIDDEN here:**
```typescript
// ❌ NEVER in routes.ts
import { ReviewRepository } from './repository'   // Skip service layer
this.db.select()...                               // DB query directly in handler
if (agent.type === 'review') { ... }              // Business logic in route
```

---

## Cross-Cutting: `src/platform/`

`platform/` is NOT a layer — it provides infrastructure shared across all modules:

| File | What it provides |
|---|---|
| `container.ts` | Composition root — all DI wiring |
| `errors.ts` | `AppError`, `NotFoundError`, `ValidationError` — used everywhere |
| `sse.ts` | `RunBus` — event bus for SSE streaming |
| `jobs.ts` | `JobRunner` — async job queue |
| `config.ts` | `AppConfig` — env loading |
| `resilience.ts` | Retry + timeout utilities for adapters |

These utilities may be imported by **any** layer. They do not introduce framework coupling into the domain.
