---
name: backend-onion-architecture
description: "Backend architecture standard for server/ modules. Answers WHERE backend code belongs and WHY — layer definitions, dependency rules, canonical module structure, and project-specific constraints for Node.js/Fastify/Drizzle/TypeScript. Use when creating new modules, placing business logic, designing services, reviewing module structure, or wiring dependency injection."
---

# Backend Onion Architecture

Answers **"where does this backend code belong and why?"** in `server/`.

**Does NOT answer:**
- "How to write a Drizzle query" → `drizzle-orm-patterns`
- "How to configure Fastify plugins, routes, or hooks" → `fastify-best-practices`
- "How to write a Zod schema" → `zod`
- "Where does this React/Next.js code go" → `frontend-architecture`

---

## Trigger — invoke BEFORE creating files or planning module structure

Invoke when the prompt contains any of:

> new module · where does X live · where to put · business logic · service layer · repository · application layer · domain layer · infrastructure layer · module structure · layer boundary · import rule · use case · composition root · dependency injection · folder structure · backend structure · how to organize · where should this go · module architecture · cross-module · adapter · workspace scope

---

## SKIP when

- Writing a specific Drizzle query (column types, joins, filters) → `drizzle-orm-patterns`
- Configuring Fastify plugins, hooks, serialization → `fastify-best-practices`
- Fixing a bug with no structural implications
- Updating an existing module without moving code between layers

---

## THE DEPENDENCY RULE (CRITICAL)

> "All code can depend on layers more central, but code cannot depend on layers further out."
> — Jeffrey Palermo, *The Onion Architecture*, 2008

**In this project — allowed directions:**

```
Presentation (routes.ts)
    │ can import ↓
Application (service.ts)
    │ can import ↓ (only via container)
Infrastructure (repository.ts, adapters/)
    │ can import ↓
db/schema · db/client · @devdigest/shared
```

**Forbidden — always:**

| Forbidden import | Why |
|---|---|
| `repository.ts` → `service.ts` | Infrastructure must not depend on Application |
| `service.ts` → `OctokitGitHubClient` | Concrete adapters belong in `platform/container.ts` only |
| `module-A/` → `module-B/service.ts` | Modules are isolated; cross-module via Container or `platform/` |
| Any layer → `process.env.*` directly | Secrets flow through `SecretsProvider` only |
| Circular imports between any two files | Always a design error |

---

## LAYER DEFINITIONS

### Layer 1 — Presentation
**File:** `modules/<name>/routes.ts`
**Purpose:** HTTP boundary only. Validates input, resolves context, delegates to Service, serializes output.

| OWNS | FORBIDDEN |
|---|---|
| Route handlers (`FastifyPluginAsync`) | Business logic of any kind |
| Zod schemas for request validation | Direct DB queries |
| HTTP status codes + response shape | Importing concrete adapters |
| Rate limiting config | Domain decisions (if/else on business rules) |
| `getContext(container, req)` call | `process.env` reads |

```typescript
// routes.ts — correct pattern
export default async function fooRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new FooService(app.container);

  app.post('/foo', { schema: { body: CreateFooSchema } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.create(req.body, workspaceId);
    return reply.status(201).send(result);
  });
}
```

---

### Layer 2 — Application (Service)
**File:** `modules/<name>/service.ts`
**Purpose:** Business logic and orchestration. Coordinates Repository + Adapters. No knowledge of HTTP.

| OWNS | FORBIDDEN |
|---|---|
| Business rules and validations | HTTP concepts (request, reply, status) |
| Orchestration of repo + adapters | Direct instantiation of concrete adapters |
| `AppError` / `NotFoundError` / `ValidationError` throws | `process.env` reads |
| Transaction coordination | Importing from `adapters/` directly |
| Cross-cutting domain logic | Calling `getContext()` |

```typescript
// service.ts — correct pattern
export class FooService {
  private repo: FooRepository;

  constructor(private container: Container) {
    this.repo = new FooRepository(container.db); // repos: OK to instantiate with db
  }

  async create(dto: CreateFooDto, workspaceId: string): Promise<FooDto> {
    if (!dto.name.trim()) throw new ValidationError('Name is required');

    // Adapters always via container — NEVER: new OctokitGitHubClient(token)
    const github = await this.container.github();
    const pr = await github.getPullRequest(dto.repoOwner, dto.repoName, dto.prNumber);

    return this.repo.insert({ ...dto, workspaceId, prTitle: pr.title });
  }
}
```

---

### Layer 3 — Infrastructure (Repository)
**File:** `modules/<name>/repository.ts`
**Purpose:** Data access only. Drizzle queries, workspace-scoped. No business logic.

| OWNS | FORBIDDEN |
|---|---|
| Drizzle queries (select, insert, update, delete) | Business rules |
| `workspace_id` scoping on every query | HTTP concepts |
| Data mapping (DB row → response DTO) | Adapter instantiation |
| Transaction handling (receives `db` or `tx`) | Calling other modules' repositories |

```typescript
// repository.ts — correct pattern
export class FooRepository {
  constructor(private db: Db) {}

  async findById(id: string, workspaceId: string): Promise<FooRow | null> {
    const rows = await this.db
      .select()
      .from(t.foos)
      .where(and(
        eq(t.foos.id, id),
        eq(t.foos.workspaceId, workspaceId), // MANDATORY — no exceptions
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(data: InsertFoo): Promise<FooRow> {
    const rows = await this.db.insert(t.foos).values(data).returning();
    return rows[0];
  }
}
```

---

### Layer 4 — Composition Root
**Files:** `platform/container.ts` · `app.ts` · `modules/index.ts`
**Purpose:** The single location where all concrete implementations are wired together.

```
platform/container.ts  ← ONLY place that instantiates concrete adapters
app.ts                 ← ONLY place that creates Container + registers modules
modules/index.ts       ← ONLY place that lists registered modules
```

Services receive `Container` via constructor and call `container.github()`, `container.llm('openai')`, etc.  
Never call the DI container from inside domain/business logic — only at construction time.

---

## CANONICAL MODULE STRUCTURE

```
server/src/modules/<name>/
├── routes.ts       # Fastify plugin — Presentation layer
├── service.ts      # Business logic — Application layer
├── repository.ts   # Drizzle queries — Infrastructure layer
├── helpers.ts      # DTOs, type converters, pure functions (no side effects)
└── types.ts        # Module-local TypeScript types (optional)
```

**After creating a module:** add one `import` + one entry in `modules/index.ts`.
No auto-discovery — if not in `modules/index.ts`, the module does not load.

**For a complete annotated example:** see `examples/reference-module.md`

---

## PROJECT-SPECIFIC RULES (CRITICAL)

Rules specific to this codebase. They override any general Onion Architecture advice.

**R1 — workspace_id on every query (data isolation)**
Every Drizzle query in `repository.ts` MUST include `eq(t.tableName.workspaceId, workspaceId)`.
A missing scope is a data isolation bug, not a style issue.

**R2 — Adapters only via Container (never import concrete classes in services)**
```typescript
// ✅ correct
const github = await this.container.github();

// ❌ forbidden in service.ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
const github = new OctokitGitHubClient(token);
```

**R3 — AppError for all expected failures**
```typescript
// ✅ correct — Fastify error handler in app.ts serializes this to ApiErrorBody
throw new NotFoundError('PR not found');
throw new ValidationError('Name is required');
throw new AppError('quota_exceeded', 'Monthly review quota exceeded', 429);

// ❌ forbidden
throw new Error('not found');
reply.status(404).send({ message: 'not found' }); // not in service.ts
```

**R4 — Secrets only via SecretsProvider**
```typescript
// ✅ correct
const key = await this.container.secrets.get('OPENAI_API_KEY');

// ❌ forbidden anywhere except container.ts
const key = process.env.OPENAI_API_KEY;
```

**R5 — vendor/shared is read-only**
`server/src/vendor/shared/` (`@devdigest/shared`) — never add, edit, or delete files here.
A change here breaks `client/`, `reviewer-core/`, and `e2e/` simultaneously.

**R6 — Module import isolation**
A module imports only from:
- Its own files (`./service.js`, `./repository.js`, etc.)
- `@devdigest/shared` (shared contracts)
- `../../platform/container` (Container type + errors)
- `../../db/schema` and `../../db/client` (Drizzle schema + Db type)
- `../_shared/` (shared module utilities: `getContext`, `schemas`)

**R7 — Static module registration**
```typescript
// modules/index.ts — add one line per new module
import foo from './foo/routes.js';
export const modules = { ..., foo };
```

---

## DEPENDENCY IMPORT MATRIX

| From ↓ / To → | `platform/container` | `db/schema` | `@devdigest/shared` | Another `modules/<x>/` | `adapters/` concrete |
|---|:---:|:---:|:---:|:---:|:---:|
| **routes.ts** | ✅ type + instance | ❌ | ✅ | ❌ | ❌ |
| **service.ts** | ✅ constructor arg | ✅ via `db` only | ✅ | ❌ | ❌ |
| **repository.ts** | ❌ (gets `Db` only) | ✅ | ✅ | ❌ | ❌ |
| **platform/container.ts** | — | ✅ | ✅ | ✅ repos only | ✅ |

---

## TOP 5 ANTI-PATTERNS

### AP-1: Business Logic in Route Handler (CRITICAL)
**Detection:** `if`, `throw AppError`, data transformation, or DB calls inside a Fastify handler.
**Fix:** Move all logic to `service.ts`. The handler does: validate → call service → return.

### AP-2: Direct Adapter Import in Service (CRITICAL)
**Detection:** `import { OctokitGitHubClient }` or `import { OpenAIProvider }` inside `service.ts` or `repository.ts`.
**Fix:** Access via `this.container.github()`, `this.container.llm('openai')`.

### AP-3: Missing workspace_id Scope (CRITICAL)
**Detection:** A Drizzle query without `eq(t.xxx.workspaceId, workspaceId)` in `repository.ts`.
**Fix:** Add workspace scope to every query. Audit all `.where()` clauses in new repositories.

### AP-4: Cross-Module Internal Import (HIGH)
**Detection:** `import { ReviewService } from '../reviews/service.js'` inside `agents/` module.
**Fix:** Use `container.reviewRepo` (shared repos on Container) or extract to `platform/`.

### AP-5: Raw Error Instead of AppError (HIGH)
**Detection:** `throw new Error('...')` inside `service.ts`, or `reply.status(4xx).send(...)` inside service code.
**Fix:** Use `throw new NotFoundError(...)`, `throw new ValidationError(...)`, or `throw new AppError(code, message, statusCode)`.

**Full anti-pattern catalog:** `examples/antipatterns.md`

---

## LAYER INTERACTION FLOW

```
HTTP Request
    │
    ▼
routes.ts
    ├─ Zod validates body/params (422 on failure → Fastify error handler)
    ├─ getContext(container, req) → { workspaceId, userId }
    └─ new FooService(app.container).doSomething(dto, workspaceId)
                │
                ▼
           service.ts
                ├─ Business validation → throw AppError (404/422/429…)
                ├─ container.github() / container.llm() for external adapters
                └─ this.repo.findById(id, workspaceId)
                              │
                              ▼
                        repository.ts
                              ├─ Drizzle query + workspace_id scope
                              └─ Returns FooRow | FooRow[] | null
                │
                ▼ (return path)
           service.ts maps row → DTO
    │
routes.ts serializes DTO → HTTP response (200/201/204)
```

---

## DECISION CRITERIA

**Apply the 3-layer module pattern (`routes` / `service` / `repository`) when:**
- Adding any L02–L08 feature to `server/src/modules/`
- The feature needs data persistence + business logic + an HTTP endpoint
- The business logic is simple to moderate (orchestration, not rich domain rules)

**Consider adding Domain Entities / Value Objects (full Onion with DDD) when:**
- Business rules are so complex they need objects that enforce their own invariants
- Multiple aggregates interact with shared rules that a service method cannot clearly own
- The feature has a rich concept lifecycle (creation → validation → state transitions → events)

**Do NOT add Onion layers pre-emptively.** A service + repository is correct for most modules.  
Add domain richness only when business rules demand it — not in anticipation of growth.
