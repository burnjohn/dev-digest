---
name: server-testing
description: Backend test patterns for Fastify/Drizzle/Vitest — test split strategy, route testing with inject(), service unit testing, DB teardown, file placement, and coverage strategy.
---

# Server Testing

## Test Split Strategy

Two test types coexist in `server/`:

| File pattern | Type | DB | When to use |
|---|---|---|---|
| `*.it.test.ts` | Integration | Real (testcontainers Postgres, needs Docker) | Route → service → DB full chain |
| `*.test.ts` | Unit | Mocked | Isolated service/utility logic |

Integration tests are slower but catch contract mismatches between layers. Unit tests are fast and precise. Both are necessary.

- Run unit tests only (no Docker needed): `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- Run integration tests only: `pnpm exec vitest run .it.test`

Integration tests are slow on first run (image pull). Subsequent runs are faster.

## Framework Rules (Non-Negotiable)

**Always use Vitest** — never Jest equivalents:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ✅ Correct
const mockFn = vi.fn()
vi.spyOn(service, 'method')
vi.mock('./module')

// ❌ Never
const mockFn = jest.fn()
jest.spyOn(...)
jest.mock(...)
```

Never mix Vitest and Jest APIs.

## Route Testing Pattern

Use `app.inject()` from Fastify's test utility — **NEVER start a real port** (no `app.listen()`):

```typescript
const response = await app.inject({
  method: 'GET',
  url: '/repos/123/pulls',
  headers: { 'x-workspace-id': 'ws-1' }
});
expect(response.statusCode).toBe(200);
const body = response.json();
```

Mock only the container adapters (DB, external HTTP clients) — **NEVER mock the service layer in route tests**.

Assert on: `response.statusCode`, `response.json()` shape. Never assert on internal service calls in route tests.

## Service Unit Testing Pattern

Call service functions directly with mocked injected dependencies. Use `vi.fn()` for each injected dependency (DB adapter, external clients):

```typescript
const mockRepo = { findAll: vi.fn().mockResolvedValue([...]) };
const svc = new MyService(mockRepo);
const result = await svc.doSomething('arg');
```

Mock only injected dependencies — never the service itself.

## Test File Placement

Test file lives NEXT TO the source file:
- `repos.service.ts` → `repos.service.test.ts`
- `repos.routes.ts` → `repos.routes.test.ts` (unit) or `repos.routes.it.test.ts` (integration)

**NEVER put tests in a separate `__tests__` directory.**

## Test Structure

Arrange-Act-Assert (AAA) pattern.

```ts
describe('ReposService', () => {
  describe('findAll', () => {
    it('returns repos for the given workspace', async () => { ... })
    it('returns empty array when workspace has no repos', async () => { ... })
    it('throws NotFoundError when workspace does not exist', async () => { ... })
  })
})
```

- `describe` names the module or method under test
- `it` names the behavior in present tense ("returns 200 when repo exists")
- Group related test cases under nested `describe` blocks for methods with multiple branches

## DB State Teardown (Integration Tests)

Each integration test file must manage its own state:

```ts
beforeEach(async () => {
  // clear affected tables or use transaction rollback
  await db.delete(tables.repos).where(eq(tables.repos.workspaceId, TEST_WS_ID))
})
afterEach(async () => {
  // verify no test data leaked
  await db.delete(tables.repos).where(eq(tables.repos.workspaceId, TEST_WS_ID))
})
```

**NEVER use shared mutable state across tests.**

## AppError Assertion Pattern

Expected failures use `AppError` — never raw strings or plain `Error`:

```ts
import { AppError } from '../../shared/errors'

// Assert on AppError class and HTTP status code
await expect(service.findById('bad-id')).rejects.toThrow(AppError)
// Or check response.statusCode for HTTP error codes in route tests
expect(response.statusCode).toBe(404)
```

Do NOT assert on raw Error messages — use status codes and error codes.

## What to Skip

- Framework internals (Fastify core, Drizzle internals)
- Generated migration files (`server/drizzle/`)
- Auto-generated types from schema
- Trivial pass-through wrappers with no branching logic

## Coverage Strategy per Module Type

| Module type | Min tests | Always cover | Skip |
|---|---|---|---|
| Route handler | 3-5 | Happy path + auth error + validation error | Framework plugin wiring |
| Service method | 2-4 | Happy path + one error case | Simple property access |
| Repository method | 2-3 | Happy path + not-found | Drizzle query builder internals |
| Utility function | 2-4 | Happy path + boundary/null input | — |
