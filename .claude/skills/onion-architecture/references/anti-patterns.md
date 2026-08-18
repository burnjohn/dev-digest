# Anti-patterns to flag in review

Four concrete smells, each grounded in something already found in this codebase.

## 1. Business logic or raw Drizzle in `routes.ts`

**Don't:**
```ts
// routes.ts
app.get('/pulls', async (req) => {
  const rows = await db.select().from(pullRequests).where(...); // Drizzle in routes.ts
  const grouped = rows.reduce((acc, r) => { /* aggregation logic */ }, {});
  return grouped;
});
```

**Do:**
```ts
// routes.ts
app.get('/pulls', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.listGrouped(workspaceId);
});
```

This is the shape of `server/src/modules/{pulls,polling,settings,workspace}/
routes.ts` today — **documented as a known legacy exception**, so don't flag those
specific existing files. Do flag this shape in *new* route handlers or in a
substantial rewrite of one of those four modules.

## 2. A repository facade that re-declares instead of delegates

**Don't:**
```ts
// repository.ts — re-declares the param shape instead of importing it
export class ReviewRepository {
  async findRun(params: { runId: string; workspaceId: string }) { /* duplicated logic */ }
}
// repository/run.repo.ts already has an equivalent findRun with its own param type
```

**Do:**
```ts
// repository.ts — thin delegate
import { findRun } from './repository/run.repo';
export class ReviewRepository {
  findRun = findRun;
}
```

This is the exact smell flagged in `server/INSIGHTS.md` (2026-08-04) for `reviews/
repository.ts`: it duplicates param types instead of importing them from
`repository/*.repo.ts`, risking silent drift between the two.

## 3. Domain/pure code reaching for a concrete adapter

**Don't:**
```ts
// reviewer-core/src/review/run.ts
import { OpenRouterProvider } from '../llm/openrouter';
const llm = new OpenRouterProvider(apiKey); // concrete class, imported directly
```

**Do:**
```ts
// reviewer-core/src/review/run.ts
export async function reviewPullRequest(input: { llm: LLMProvider; /* ... */ }) {
  const result = await input.llm.completeStructured<Review>(/* ... */);
}
```

The concrete `OpenRouterProvider` is instantiated once, outside `reviewer-core/`, and
passed in. The same rule applies to any new port DevDigest adds — the domain/
application code takes the interface as a parameter; only the caller in `server/`
knows about the concrete class.

## 4. Forking a Zod contract instead of extending it

**Don't:**
```ts
// A second, hand-written type that duplicates Finding's fields
export const FindingSummary = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high']), // copy-pasted, can drift from Finding
});
```

**Do:**
```ts
export const FindingSummary = Finding.pick({ id: true, severity: true });
```

See [zod-contracts-across-layers.md](zod-contracts-across-layers.md) for the full
rule.
