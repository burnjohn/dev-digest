# Infrastructure Layer

`modules/*/repository.ts` and `src/adapters/` — all external I/O. The only layer that speaks Drizzle, Octokit, OpenAI SDK, simple-git, etc.

---

## Repository Anatomy

Every repository follows this structure:

```typescript
import { eq, and, desc } from 'drizzle-orm';
import { Db } from '../../db/client';
import * as t from '../../db/schema';
import { Agent } from '../../vendor/shared/contracts/platform';  // ← domain type
import { NotFoundError } from '../../platform/errors';

// ✅ $inferSelect stays PRIVATE — never exported, never returned
type AgentRow = typeof t.agents.$inferSelect;

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.agents.createdAt));
    return rows.map(row => this.toDomain(row));  // ← always map before returning
  }

  async getById(workspaceId: string, id: string): Promise<Agent | null> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.id, id), eq(t.agents.workspaceId, workspaceId)));
    return row ? this.toDomain(row) : null;
  }

  async insert(data: Omit<AgentRow, 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const [row] = await this.db.insert(t.agents).values(data).returning();
    return this.toDomain(row);
  }

  async update(id: string, patch: Partial<AgentRow>): Promise<Agent> {
    const [row] = await this.db
      .update(t.agents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.agents.id, id))
      .returning();
    if (!row) throw new NotFoundError(`Agent ${id}`);
    return this.toDomain(row);
  }

  // ─── Data Mappers ──────────────────────────────────────────────────────────

  private toDomain(row: AgentRow): Agent {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
```

---

## Data Mapper Rules

The `toDomain()` / `toDb()` pair is the **only place** where Drizzle row types and domain types touch:

```typescript
// ✅ CORRECT: $inferSelect is private, never leaks out
private toDomain(row: typeof t.reviews.$inferSelect): Review {
  return {
    id: row.id,
    prId: row.prId,
    // ... map all fields
  };
}

// ❌ WRONG: leaking DB type to caller
async getReview(id: string): Promise<typeof t.reviews.$inferSelect> {  // BAD
  const [row] = await this.db.select()...
  return row;  // Service now knows about Drizzle schema
}
```

Key rules:
- `toDomain()` is always `private`
- Return type of all public methods is a contract type (from `vendor/shared/contracts/`)
- `$inferSelect` / `$inferInsert` are never exported from the repository file

---

## Workspace Scoping — MANDATORY

**Every** query that accesses tenant data must filter by `workspaceId`:

```typescript
// ✅ CORRECT
.where(and(eq(t.agents.id, id), eq(t.agents.workspaceId, workspaceId)))

// ❌ WRONG — missing workspace scope, cross-tenant data leak
.where(eq(t.agents.id, id))
```

The `workspaceId` comes from `getContext()` in the route handler and flows down through service → repository. Never look up records without it.

---

## Fine-Grained Sub-Repositories

When a module has many aggregate types, split into sub-repos under `repository/`:

```
modules/reviews/
├── repository.ts          ← public facade, composes sub-repos
└── repository/
    ├── review.repo.ts     ← reviews + findings
    ├── run.repo.ts        ← agentRuns + runTraces
    └── pull.repo.ts       ← pullRequests (read-only view)
```

The facade delegates to sub-repos; callers only ever interact with `ReviewRepository`.

---

## Adapter Placement

External service implementations belong in `src/adapters/`, never in `modules/`:

```
src/adapters/
├── llm/
│   ├── openai.ts          ← OpenAIProvider implements LLMProvider
│   ├── anthropic.ts
│   └── openrouter.ts
├── github/
│   └── octokit.ts         ← OctokitGitHubClient implements GitHubClient
├── git/
│   └── simple-git.ts
└── mocks.ts               ← Test doubles for ALL adapters
```

Adapters implement interfaces defined in `vendor/shared/adapters.ts`. The Container wires the production implementations; tests swap in mocks via `ContainerOverrides`.

---

## Transactions

For operations that must be atomic, pass the transaction context through:

```typescript
async createReviewWithFindings(
  review: InsertReview,
  findings: InsertFinding[],
): Promise<Review> {
  return this.db.transaction(async (tx) => {
    const [reviewRow] = await tx.insert(t.reviews).values(review).returning();
    await tx.insert(t.findings).values(findings.map(f => ({ ...f, reviewId: reviewRow.id })));
    return this.toDomain(reviewRow);
  });
}
```

Never let a service coordinate multiple separate repo calls that should be atomic. The repository owns transaction boundaries.
