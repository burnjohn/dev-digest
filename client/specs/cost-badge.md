# Spec: Cost Badge (L01)

Displays the monetary cost of each review run throughout the application.

---

## 1. What It Shows

The total USD cost charged by the LLM provider for a single agent run.

- Stored as `agent_runs.cost_usd` (double precision, nullable)
- Computed by reviewer-core and accumulated across all LLM calls in a map-reduce run
- `null` means the cost is genuinely unknown (model not in pricing table, provider did not report it)
- `0.0` means the run was free (e.g. `z-ai/glm-4.7-flash`) — distinct from unknown

---

## 2. Where It Appears

### 2.1 Pull Requests List — Cost column

A new **Cost** column in the PR table:

| Column | Value |
|--------|-------|
| Header | `COST` |
| Value | Sum of `cost_usd` across all `status='done'` agent runs for that PR |
| Format | `$0.014` |
| Null | `—` (em dash) when no completed runs or all costs are null |

**Assumption**: The column shows the cumulative total across all runs ever completed for the PR, not only the latest multi-agent batch. This gives a true picture of total spend per PR.

---

### 2.2 PR Detail → Agent Runs tab → Timeline cards

Per-run cost shown inline on each completed run card, adjacent to the token count:

```
9 119 tok · $0.0013
```

| State | Behavior |
|-------|----------|
| `status='done'`, cost known | `{tokens} tok · {cost}` |
| `status='done'`, cost null | `{tokens} tok` (no cost segment) |
| `status='running'` | omit entirely (cost not yet known) |
| `status='failed'` or `'cancelled'` | omit (cost is not recorded for failures) |

---

### 2.3 Run Trace Drawer → Stats panel

A new **Cost** stat card alongside the existing metrics:

```
DURATION    TOKENS      COST      FINDINGS
8.2s        15k→1.2k    $0.06     3
```

| State | Behavior |
|-------|----------|
| cost known | formatted value (e.g. `$0.06`) |
| cost null | `—` |

---

## 3. Formatting

Single shared utility across all three locations:

```ts
// client/src/lib/format.ts (add alongside existing helpers)
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(usd);
}
```

Examples:

| Raw value | Output |
|-----------|--------|
| `null` | `—` |
| `0` | `$0.00` |
| `0.0013` | `$0.0013` |
| `0.014` | `$0.014` |
| `0.06` | `$0.06` |
| `1.5` | `$1.50` |

The `Intl.NumberFormat` `maximumFractionDigits: 4` rule means the formatter trims trailing zeros
while preserving enough precision for sub-cent values.

---

## 4. Data Source

```
OpenRouter API response
  └─ usage.cost  ──────────────────────────────────────────────► costUsd (real cost)
                                                                     │
Static pricing.ts / live price-book (fallback)                        │
  └─ (tokensIn × priceIn + tokensOut × priceOut) / 1_000_000  ──► costUsd (estimated)
                                                                     │
Model unknown in both sources                                          │
  └─ null  ────────────────────────────────────────────────────► costUsd = null
```

The accumulation already happens in reviewer-core (`run.ts` line 184):

```ts
costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
```

The server only needs to persist `outcome.costUsd` — no new calculation logic is required.

---

## 5. Null / Unavailable State

| Trigger | Stored value | Displayed |
|---------|-------------|-----------|
| Model not in pricing table and provider didn't report cost | `NULL` | `—` |
| Run failed or was cancelled | `NULL` | `—` (omitted in timeline) |
| Free model (price = $0) | `0.0` | `$0.00` |
| Completed run, cost known | `0.0042` | `$0.0042` |

---

## 6. Loading State

While `status = 'running'`, no cost is shown anywhere. Cost only appears after the run transitions to `done`.

---

---

# Implementation Plan

---

## A. Database Changes

### A1. New migration — `server/src/db/migrations/0010_add_agent_run_cost_usd.sql`

```sql
ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;
```

**Context**: `cost_usd` was present at schema inception (migration 0000) and dropped in migration 0009.
Re-adding it via a new migration is the only safe path — never edit an applied migration.
All existing `agent_runs` rows will read `cost_usd = NULL` which correctly displays as `—`.

After writing the file, regenerate the Drizzle snapshot:

```sh
cd server && pnpm db:generate   # review the generated migration
cd server && pnpm db:migrate    # apply to local DB
```

### A2. Drizzle schema — `server/src/db/schema/runs.ts`

Add `costUsd` to the `agentRuns` table definition:

```ts
import { pgTable, uuid, text, integer, doublePrecision, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const agentRuns = pgTable('agent_runs', {
  // ... existing columns ...
  costUsd: doublePrecision('cost_usd'),   // NEW — nullable, null = unknown cost
});
```

---

## B. Backend Changes

### B1. Shared contract — `server/src/vendor/shared/contracts/trace.ts`

#### `RunStats` — add `cost_usd`

```ts
export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  findings: z.number().int(),
  grounding: z.string(),
  cost_usd: z.number().nullish(), // nullish (not nullable) for backwards compat with stored JSONB
});
```

**Why `.nullish()` and not `.nullable()`**: `RunStats` is stored as part of the `run_traces.trace`
JSONB document. Existing persisted traces do not have `cost_usd` at all (the field is absent, not
`null`). Zod's `.nullable()` accepts `null` but rejects `undefined`; `.nullish()` accepts both.
Without this, parsing old traces would throw at runtime.

#### `RunSummary` — add `cost_usd`

```ts
export const RunSummary = z.object({
  // ... existing fields ...
  cost_usd: z.number().nullable(),   // NEW — null when cost unknown or run not done
});
```

`.nullable()` (not `.nullish()`) is correct here because `RunSummary` is always freshly constructed
from the DB row, never read from a historical JSONB document.

---

### B2. Shared contract — `server/src/vendor/shared/contracts/platform.ts`

#### `PrMeta` — add `cost_usd`

```ts
export const PrMeta = z.object({
  // ... existing fields ...
  cost_usd: z.number().nullish(),  // NEW — sum of completed runs; null when none
});
```

`.nullish()` chosen because the GitHub client also implements `listPullRequests → PrMeta[]` (see
`adapters.ts`) and that path never produces cost data; `undefined` from that path must be accepted.

---

### B3. Repository — `server/src/modules/reviews/repository/run.repo.ts`

#### `completeAgentRun()` — accept and write `costUsd`

Extend the `values` parameter:

```ts
export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    score?: number | null;
    blockers?: number | null;
    error?: string | null;
    costUsd?: number | null;   // NEW
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      // ... existing fields ...
      costUsd: values.costUsd ?? null,   // NEW
    })
    .where(eq(t.agentRuns.id, runId));
}
```

#### `listRunsForPull()` — include `cost_usd` in mapped output

```ts
return rows.map(({ run, agentName }) => ({
  // ... existing fields ...
  cost_usd: run.costUsd ?? null,   // NEW
}));
```

---

### B4. Run executor — `server/src/modules/reviews/run-executor.ts`

#### `runOneAgent()` — pass `costUsd` to persistence and trace

Change line 213 from:

```ts
const { tokensIn, tokensOut, grounding } = outcome;
```

to:

```ts
const { tokensIn, tokensOut, grounding, costUsd } = outcome;
```

Pass it to `completeAgentRun()` (lines 243–253):

```ts
await this.repo.completeAgentRun(runId, {
  status: 'done',
  durationMs,
  tokensIn,
  tokensOut,
  findingsCount: findingRows.length,
  grounding,
  score: outcome.review.score,
  blockers,
  error: null,
  costUsd,           // NEW
});
```

Add `cost_usd` to the trace stats (lines 255–270):

```ts
const trace: RunTrace = {
  // ...
  stats: {
    duration_ms: durationMs,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    findings: findingRows.length,
    grounding,
    cost_usd: costUsd ?? null,   // NEW
  },
  // ...
};
```

#### `traceFromBuffer()` — include `cost_usd: null` in the failure trace

```ts
stats: {
  duration_ms: durationMs,
  tokens_in: 0,
  tokens_out: 0,
  findings: 0,
  grounding,
  cost_usd: null,   // NEW — no cost for failed/cancelled runs
},
```

---

### B5. Pulls routes — `server/src/modules/pulls/routes.ts`

Add a cost aggregation query after the existing score lookup (around line 120).
Import `sum` from drizzle-orm (already uses `and`, `desc`, `eq`, `inArray`):

```ts
import { and, desc, eq, inArray, sum } from 'drizzle-orm';
```

Aggregate cost per PR:

```ts
const costByPr = new Map<string, number | null>();
if (prIds.length > 0) {
  const costRows = await container.db
    .select({
      prId: t.agentRuns.prId,
      totalCost: sum(t.agentRuns.costUsd),
    })
    .from(t.agentRuns)
    .where(
      and(
        inArray(t.agentRuns.prId, prIds),
        eq(t.agentRuns.status, 'done'),
      ),
    )
    .groupBy(t.agentRuns.prId);
  for (const row of costRows) {
    if (row.prId) costByPr.set(row.prId, row.totalCost != null ? Number(row.totalCost) : null);
  }
}
```

Add `cost_usd` to the returned `PrMeta` shape (inside `rows.map()`):

```ts
cost_usd: costByPr.get(r.id) ?? null,
```

**Note**: Postgres `SUM()` over an all-null set returns `null`, which is the correct null signal.
The explicit `Number()` coercion is needed because Drizzle returns `sum()` as `string | null` for
`numeric`/`real` columns to avoid floating-point precision loss in the JS serialisation layer.

---

## C. Frontend Changes

### C1. Format utility

File: `client/src/lib/format.ts` (create if absent; check if a format file already exists).

```ts
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(usd);
}
```

### C2. Pull Requests list — Cost column

File: the PR list table component (locate under `client/src/app/repos/[repoId]/`).

- Add `COST` column header after `STATUS`, before `UPDATED` (matching the screenshot column order)
- Render `formatCost(pr.cost_usd)` per row
- Use `tabular-nums` font variant and right-align for visual consistency with numeric columns
- Null renders as `—` (handled inside `formatCost`)

### C3. Run History timeline cards

File: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx`

In the completed-run card row, after the token count segment:

```tsx
{run.tokens_in != null && (
  <span className="text-muted-foreground text-xs">
    {run.tokens_in.toLocaleString()} tok
    {run.cost_usd != null && ` · ${formatCost(run.cost_usd)}`}
  </span>
)}
```

Only append `· {cost}` when cost is not null. Do not show cost for `failed`/`cancelled` runs
(they already show their error message instead of token counts).

### C4. Run Trace Drawer stats panel

File: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`

Add a COST stat between TOKENS and FINDINGS (matching the screenshot order):

```tsx
<StatCard label="Cost" value={formatCost(stats.cost_usd)} />
```

Where `StatCard` is whatever component renders the existing DURATION / TOKENS / FINDINGS blocks.
Adapt to the exact component API present in the file.

---

## D. API Changes Summary

| Endpoint | New field | Type | Notes |
|----------|-----------|------|-------|
| `GET /repos/:id/pulls` → `PrMeta[]` | `cost_usd` | `number \| null` | Sum of all done runs for the PR |
| `GET /pulls/:id/runs` → `RunSummary[]` | `cost_usd` | `number \| null` | Per-run cost |
| `GET /runs/:id/trace` → `RunTrace` | `stats.cost_usd` | `number \| null` | From stored JSONB |

All additions are additive and backwards compatible on the wire: clients that don't expect
`cost_usd` simply ignore it; the server contract validation via Zod will enforce the field is
present from the server's side.

---

## E. UI/UX Considerations

1. **Column width**: The COST column in the PR list should be ~80–90px (the values are short).
2. **Alignment**: Right-align cost values; use `font-variant-numeric: tabular-nums` so decimal
   points stay visually aligned when scanning down the column.
3. **`$0.00` vs `—`**: Never conflate them. A `$0.00` cost means a free model was used.
   `—` means the cost is unknown. They carry different information.
4. **No color emphasis**: Cost is informational. Do not render it in red/green — it is not a
   pass/fail signal.
5. **No loading spinner for cost**: While a run is in progress, the cost field is absent, not
   "loading". Show nothing until the run completes.
6. **Token abbreviation already used in trace**: `15k→1.2k` is the existing format for TOKENS in
   the trace drawer. Keep COST adjacent but distinctly formatted (full `$X.XXXX` notation).

---

## F. Edge Cases

| Case | Stored value | Display |
|------|-------------|---------|
| Unknown model / provider does not return cost | `NULL` | `—` |
| Free model (`z-ai/glm-4.7-flash`, price = 0) | `0.0` | `$0.00` |
| Run failed (partial tokens consumed) | `NULL` | omitted in timeline, `—` in trace |
| Run cancelled | `NULL` | omitted in timeline, `—` in trace |
| PR with no completed runs | n/a | `—` in PR list |
| All runs for a PR have null cost | `SUM()` → `NULL` | `—` in PR list |
| Some runs null, some have cost | `SUM()` ignores nulls | sum of non-null values shown |
| Map-reduce run (multiple LLM calls) | accumulated in reviewer-core | stored as total; single value shown |
| Existing `run_traces` without `cost_usd` in stats | field absent in JSONB | parsed as `undefined` via `.nullish()` → `—` |
| Very large cost (pathological long run) | stored as-is | `$12.3456` — no cap |

---

## G. Error Handling

1. **DB write failure**: If `completeAgentRun()` throws, the existing error handling in
   `run-executor.ts` catches it and marks the run failed. Cost loss is acceptable — it is
   observational data, not business-critical.
2. **Old JSONB traces**: `RunStats.cost_usd` is `.nullish()` so Zod parses absent fields as
   `undefined`, which `formatCost` renders as `—`. No runtime errors.
3. **Drizzle `sum()` return type**: Drizzle returns aggregated numeric columns as `string | null`.
   An explicit `Number()` coercion is required in `pulls/routes.ts` before storing in the map.
   If `NaN` is produced (should not happen), treat as null via `Number.isNaN()` guard.
4. **Provider quota errors** (e.g. OpenAI 429): The run fails before a result is returned; `costUsd`
   is not set. The failure path stores `costUsd = null`. Correct behavior.

---

## H. Testing Strategy

### Unit tests (hermetic — no Docker)

| Test | File | What to assert |
|------|------|---------------|
| `formatCost(null)` returns `'—'` | `format.test.ts` | Null guard |
| `formatCost(0)` returns `'$0.00'` | `format.test.ts` | Zero / free model |
| `formatCost(0.0013)` returns `'$0.0013'` | `format.test.ts` | Sub-cent precision |
| `formatCost(1.5)` returns `'$1.50'` | `format.test.ts` | Trailing-zero trim |
| Old `RunStats` JSONB (no `cost_usd`) parses OK | `trace.contract.test.ts` | Backwards compat |
| `listRunsForPull` maps `costUsd` → `cost_usd` | `run.repo.test.ts` | Field mapping |

### Integration tests (testcontainers Postgres)

| Test | Scenario | Assert |
|------|----------|--------|
| Cost persisted | Mock LLM returns `costUsd: 0.0042`; run completes | `agent_runs.cost_usd = 0.0042` |
| Null cost persisted | Mock LLM returns `costUsd: null` | `agent_runs.cost_usd IS NULL` |
| PR list cost aggregation | 3 runs: 0.001, 0.002, null | `PrMeta.cost_usd = 0.003` |
| PR list with all-null costs | All runs have null cost | `PrMeta.cost_usd = null` |
| PR list with no runs | PR has no runs | `PrMeta.cost_usd = null` |

### Frontend component tests (Vitest + RTL)

| Test | Component | What to assert |
|------|-----------|---------------|
| COST column renders | PR list | `$0.014` in cell for run with cost |
| COST column shows `—` | PR list | null cost PR |
| Cost inline in timeline | RunHistory card | `· $0.0013` segment appears for done run |
| Cost omitted when null | RunHistory card | no cost segment when `cost_usd = null` |
| Cost omitted for failed run | RunHistory card | failed run shows no cost |
| COST stat renders | TraceBody | `$0.06` stat card visible |
| COST stat shows `—` | TraceBody | null `cost_usd` in stats |

### Manual smoke test checklist

- [ ] Run a review via an OpenRouter agent (e.g. `deepseek/deepseek-v4-flash`)
  - Cost appears in the PR list COST column
  - Cost appears in the timeline card inline
  - Cost appears in the trace drawer COST stat
- [ ] Run a review with a model not in the pricing table
  - All three locations show `—`
- [ ] PR with no runs shows `—` in COST column
- [ ] Seeded data still loads cleanly after migration (no schema errors)
- [ ] Existing run traces (pre-migration) open in the trace drawer without errors

---

## I. Rollout Plan

| Step | Action | Risk |
|------|--------|------|
| 1 | Write and apply migration `0010` (`ALTER TABLE agent_runs ADD COLUMN cost_usd double precision`) | Low — adds nullable column; no downtime |
| 2 | Deploy server: schema + `run.repo.ts` + `run-executor.ts` + `pulls/routes.ts` + contracts | Low — new fields are additive |
| 3 | Deploy client: `formatCost` utility + 3 UI locations | Low — new fields degrade to `—` on old API |
| 4 | Verify: run a real review and confirm cost appears in all 3 locations | — |
| 5 | Confirm seeded PRs / old runs show `—` (not errors) | — |

**Rollback**: removing the column from the Drizzle schema + reverting application code is sufficient.
The migration column is nullable — no data integrity risk. No dependent migrations reference
`cost_usd` at this point.

---

## J. Explicit Assumptions

1. **PR list cost = sum of all completed runs**, not just the latest batch. Rationale: a developer
   cares about total spend per PR, not per-session spend.
2. **Failed/cancelled runs do not record cost.** Even if tokens were consumed before the error,
   partial cost is not tracked. Simplifies error paths; avoids misleading partial numbers.
3. **`$0.00` ≠ `—`.** Zero is a meaningful value (free model used intentionally). Only null maps
   to `—`.
4. **No per-file cost breakdown.** Map-reduce runs accumulate cost across all file chunks and store
   a single total. The per-file split is not surfaced in the UI.
5. **Drizzle `sum()` type coercion.** The aggregated value comes back as `string | null` from
   Drizzle. An explicit `Number()` coercion is applied in `pulls/routes.ts` before the value is
   stored in the `costByPr` map and returned in the API response.
