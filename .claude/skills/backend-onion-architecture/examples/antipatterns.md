# Anti-Pattern Catalog

Extended reference for all 10 anti-patterns. The top 5 are summarized in `SKILL.md`.  
Load this file during code review or architecture audits.

---

## AP-1: Business Logic in Route Handler

**Category:** CRITICAL
**Origin:** Fat Controller anti-pattern, well-documented by Martin Fowler (PoEAA, 2002)

**Description:**
Route handlers (`routes.ts`) contain `if/else` decisions, data transformations, `throw AppError`, or DB calls that belong in `service.ts`.

**Detection:**
```typescript
// ❌ business logic in route handler
app.post('/orders', async (req, reply) => {
  if (!req.body.userId) return reply.status(400).send({ error: 'userId required' });
  const user = await db.select().from(t.users).where(eq(t.users.id, req.body.userId));
  if (!user.length) return reply.status(404).send({ error: 'User not found' });
  const price = req.body.quantity * req.body.unitPrice * 1.2; // business rule in handler
  // ...
});
```

**Fix:**
```typescript
// ✅ route delegates entirely to service
app.post('/orders', { schema: { body: CreateOrderSchema } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const order = await service.createOrder(req.body, workspaceId);
  return reply.status(201).send(order);
});
```

---

## AP-2: Direct Adapter Import in Service

**Category:** CRITICAL
**Origin:** Violation of Dependency Inversion Principle (Robert C. Martin, *Clean Architecture*, 2017)

**Description:**
A `service.ts` file imports and instantiates a concrete adapter class (LLM provider, GitHub client, etc.) instead of getting it from the Container.

**Detection:**
```typescript
// ❌ concrete adapter imported in service
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { OpenAIProvider } from '../../adapters/llm/openai.js';

export class ReviewService {
  private github = new OctokitGitHubClient(process.env.GITHUB_TOKEN!); // two violations
}
```

**Fix:**
```typescript
// ✅ adapters resolved via Container (tests inject mocks via ContainerOverrides)
export class ReviewService {
  constructor(private container: Container) {}

  async doWork() {
    const github = await this.container.github();
    const llm = await this.container.llm('openai');
  }
}
```

---

## AP-3: Missing workspace_id Scope

**Category:** CRITICAL
**Origin:** Multi-tenancy data isolation requirement; specific to this project

**Description:**
A Drizzle query in `repository.ts` omits `eq(t.tableName.workspaceId, workspaceId)`. Any authenticated user can access another workspace's data.

**Detection:**
```typescript
// ❌ no workspace scope — data isolation breach
async findByPrId(prId: string): Promise<ReviewRow[]> {
  return this.db.select().from(t.reviews).where(eq(t.reviews.prId, prId));
}
```

**Fix:**
```typescript
// ✅ always scope by workspaceId
async findByPrId(prId: string, workspaceId: string): Promise<ReviewRow[]> {
  return this.db
    .select()
    .from(t.reviews)
    .where(and(
      eq(t.reviews.prId, prId),
      eq(t.reviews.workspaceId, workspaceId),
    ));
}
```

---

## AP-4: Cross-Module Internal Import

**Category:** HIGH
**Origin:** Module isolation rule in `server/src/modules/AGENTS.md`

**Description:**
Module A imports from module B's internal files (`service.ts`, `repository.ts`) instead of using shared infrastructure on `Container` or `platform/`.

**Detection:**
```typescript
// ❌ agents module reaching into reviews internals
import { ReviewService } from '../reviews/service.js'; // inside agents/service.ts
```

**Fix:**
```typescript
// ✅ option 1: use shared repo already on Container
const review = await this.container.reviewRepo.findById(reviewId);

// ✅ option 2: if the shared need is new, add it to Container
// platform/container.ts:
get fooRepo(): FooRepository {
  return (this._fooRepo ??= new FooRepository(this.db));
}
```

---

## AP-5: Raw Error Instead of AppError

**Category:** HIGH
**Origin:** `app.ts` error handler pattern; `platform/errors.ts` taxonomy

**Description:**
Throwing `new Error(...)` or a plain string from service code, or calling `reply.status(4xx)` from inside `service.ts`.

**Detection:**
```typescript
// ❌ raw error — no code, wrong status, inconsistent envelope
throw new Error('User not found');
throw 'invalid input';
reply.status(404).send({ message: 'not found' }); // in service, not route
```

**Fix:**
```typescript
// ✅ typed errors from platform/errors.ts
import { NotFoundError, ValidationError, AppError } from '../../platform/errors.js';

throw new NotFoundError('User not found');
throw new ValidationError('Name cannot be empty');
throw new AppError('quota_exceeded', 'Monthly review limit reached', 429);
```

Available typed errors: `NotFoundError` · `ValidationError` · `ExternalServiceError` · `ConfigError` · `AppError` (generic).

---

## AP-6: Secrets Read Directly from process.env

**Category:** HIGH
**Origin:** `AGENTS.md`: "Secrets → SecretsProvider only. Never read from process.env directly in services."

**Description:**
A service or adapter reads API keys, tokens, or credentials directly from `process.env` instead of going through `SecretsProvider`.

**Detection:**
```typescript
// ❌ process.env in service
const key = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey: key });
```

**Fix:**
```typescript
// ✅ via SecretsProvider in Container (already handled for all known adapters)
const llm = await this.container.llm('openai'); // Container reads the key internally

// ✅ for a genuinely new secret needed in a service:
const key = await this.container.secrets.get('MY_NEW_API_KEY');
```

---

## AP-7: Anemic Service (Logic Leaked to Routes)

**Category:** MEDIUM
**Origin:** Anemic Domain Model, Martin Fowler bliki, 2003; adapted here to Service layer

**Description:**
The service method is a thin pass-through that does nothing: it calls the repository and returns the result. All real decisions happen in the route handler. This is the inverse of AP-1.

**Detection:**
```typescript
// ❌ anemic service — all logic is actually in routes.ts
export class FooService {
  async getAll(workspaceId: string) {
    return this.repo.findAll(workspaceId); // no business logic whatsoever
  }
}
```

This is only a problem when the route handler that calls it contains business logic. A truly thin service is fine if the route handler is also thin.

**Fix:**
Ensure that business rules (authorization checks, state validation, enrichment from external systems) live in `service.ts`, not in `routes.ts`.

---

## AP-8: Repository Per Table Instead of Per Domain Concept

**Category:** MEDIUM
**Origin:** Repository Pattern, Martin Fowler, *Patterns of Enterprise Application Architecture*, 2002

**Description:**
Creating one repository class for every database table, including junction tables and sub-entities that belong to an aggregate.

**Detection:**
```typescript
// ❌ three repositories for one logical aggregate
class OrderRepository {}
class OrderLineRepository {}     // OrderLine is part of Order aggregate
class OrderStatusRepository {}   // So is OrderStatus
```

**Fix:**
One repository per domain concept (aggregate). `OrderRepository` handles the full Order including its lines and status — there is no `OrderLineRepository`.

```typescript
// ✅ one repository for the Order aggregate
class OrderRepository {
  async findById(id: string, workspaceId: string): Promise<OrderWithLines | null> {
    // Single query with join to fetch Order + all its OrderLines
  }
  async save(order: OrderWithLines): Promise<void> {
    // Upsert order row + upsert/delete order_lines in one transaction
  }
}
```

---

## AP-9: Module Registration Forgotten

**Category:** MEDIUM
**Origin:** `modules/index.ts` static registration requirement; project-specific

**Description:**
A developer creates `modules/<name>/routes.ts` but forgets to add the import and entry to `modules/index.ts`. The module never loads, no error is thrown, routes silently return 404.

**Detection:** Created the routes file, API returns 404 on all new routes, no startup error.

**Fix:**
```typescript
// modules/index.ts — both lines are required
import foo from './foo/routes.js';           // ← 1. import
export const modules = { ..., foo };         // ← 2. register
```

Check `modules/index.ts` immediately after creating a new module folder.

---

## AP-10: Architectural Drift

**Category:** MEDIUM
**Origin:** Ward Cunningham's Technical Debt; documented by Khalil Stemmler (khalilstemmler.com) and Allegro Engineering Blog (2023)

**Description:**
The architecture starts correct, but over time developers take shortcuts: business logic creeps into routes, services import concrete adapters, cross-module imports appear. The layering erodes silently.

**Detection:** Run these checks during code review:
- Any `import` inside `service.ts` that points to `adapters/` (outside `platform/container`)
- Any `if/throw` inside route handler bodies beyond input validation
- Any Drizzle query without `workspaceId` in the WHERE clause
- Any module importing from another module's internal files

**Fix (preventive):**
- Add ESLint `import/no-restricted-paths` rules to enforce layer boundaries in CI
- Include layer boundary check in every PR template
- Run architecture audits at lesson boundaries (before each L0X milestone)
