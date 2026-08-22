# Dependency Rule

The single most important rule: **imports flow inward only**. A file in an outer layer may import from any inner layer. A file in an inner layer may NEVER import from an outer layer.

```
Domain ←── Application ←── Infrastructure ←── Presentation
  ↑                                                  │
  └──────────────────────────────────────────────────┘
                 (only inward)
```

---

## Allow-List Per Layer

### Domain (`vendor/shared/contracts/`, domain entities)

| May import | May NOT import |
|---|---|
| Other domain types/interfaces | `drizzle-orm` |
| `platform/errors.ts` (AppError base) | `fastify` |
| Node built-ins (rare) | `zod` |
| Nothing else | Any module's `service.ts`, `repository.ts`, `routes.ts` |

### Application (`modules/*/service.ts`)

| May import | May NOT import |
|---|---|
| Domain contracts (`vendor/shared/contracts/`) | `drizzle-orm` |
| `platform/container.ts` (Container type) | `fastify` |
| `platform/errors.ts` | Another module's `routes.ts` |
| `platform/jobs.ts`, `platform/sse.ts` | `db/schema/*` directly |
| Other services (cross-module orchestration) | `adapters/*` directly (use `container.llm()` etc.) |
| `zod` for precondition checks only | |

### Infrastructure (`modules/*/repository.ts`, `adapters/`)

| May import | May NOT import |
|---|---|
| Domain contracts | `fastify` |
| `drizzle-orm` | Any module's `routes.ts` or `service.ts` |
| `db/schema/*` | Another module's `repository.ts` (use its service instead) |
| `platform/errors.ts` | |
| External SDKs (octokit, openai, etc.) in adapters | |

### Presentation (`modules/*/routes.ts`)

| May import | May NOT import |
|---|---|
| Own module's `service.ts` | Own module's `repository.ts` (skip service!) |
| `_shared/schemas.ts`, `_shared/context.ts` | `drizzle-orm` |
| Domain contracts (for response types) | `db/schema/*` |
| `zod` for HTTP schemas | `adapters/*` |
| `platform/errors.ts` | |

### Container (`platform/container.ts`)

May import anything — it is the composition root. This is the only exception.

---

## Violation Examples

```typescript
// ❌ VIOLATION: service imports from repository of another module
// modules/reviews/service.ts
import { AgentsRepository } from '../agents/repository';  // BAD — cross-module repo access

// ✅ CORRECT: use the other module's service, or share via container
import { Container } from '../../platform/container';
// then: this.container.agentsRepo  (already on Container)
```

```typescript
// ❌ VIOLATION: route skips service layer
// modules/agents/routes.ts
const agents = await new AgentsRepository(container.db).list(workspaceId);  // BAD

// ✅ CORRECT
const service = new AgentsService(container);
const agents = await service.list(workspaceId);
```

```typescript
// ❌ VIOLATION: repository imports domain service
// modules/repos/repository.ts
import { ReposService } from './service';  // BAD — infra importing application
```

```typescript
// ❌ VIOLATION: service imports Drizzle schema
// modules/pulls/service.ts
import { pullRequests } from '../../db/schema/pulls';  // BAD
const rows = await this.container.db.select().from(pullRequests)...  // BAD

// ✅ CORRECT: delegate to repo
const pulls = await this.repo.listByWorkspace(workspaceId);
```

---

## Cross-Module Communication

Modules communicate **only through their service layer**:

```typescript
// ✅ CORRECT: ReviewService uses Container to get agents (not AgentsRepository directly)
export class ReviewService {
  constructor(private container: Container) {
    this.agents = container.agentsRepo;  // Pre-built on Container
  }
}
```

Never reach into another module's `repository.ts` from a service. If you need data from another module, either:
1. Use its service (already on `Container` or instantiate it)
2. Add a property to `Container` that exposes its repository
