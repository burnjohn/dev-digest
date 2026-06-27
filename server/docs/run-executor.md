# Run Executor — Error Resilience Patterns

`src/modules/reviews/run-executor.ts` — `runOneAgent()` orchestrates a single LLM review run.
This document captures the three patterns that prevent data loss when the LLM succeeds but a
subsequent step (e.g., a DB write) fails.

## Pattern 1: Partial capture variables

The LLM call (`reviewPullRequest`) is the most expensive and least reliable step. If the DB
write after it fails, the catch block must still be able to record what the LLM returned.

Declare capture variables **before** the try block, assign them immediately after
`reviewPullRequest` returns:

```typescript
let partialCostUsd: number | null = null;
let partialCostKnown = false;        // explicit flag — see Pattern 3
let partialTokensIn = 0;
let partialTokensOut = 0;
let partialGrounding = '0/0 passed';
let partialFindingsCount = 0;

try {
  const outcome = await reviewPullRequest(input);
  partialCostUsd = outcome.costUsd ?? null;
  partialCostKnown = true;
  partialTokensIn = outcome.tokensIn;
  partialTokensOut = outcome.tokensOut;
  partialGrounding = outcome.grounding;
  partialFindingsCount = outcome.review.findings.length;
  // ...DB writes that may throw...
} catch (err) {
  // partialCostKnown/tokensIn/etc. hold real values if LLM succeeded
}
```

## Pattern 2: `runCompleted` guard

Both the success path and the catch path call `completeAgentRun` and `saveRunTrace`. Without a
guard, if `saveRunTrace` throws in the success path, the catch path overwrites `status='done'`
with `status='failed'` — corrupting a completed run.

```typescript
let runCompleted = false;

try {
  await this.repo.completeAgentRun(runId, { status: 'done', ... });
  await this.repo.saveRunTrace(runId, trace);
  runCompleted = true;
} catch (err) {
  if (!runCompleted) {
    await this.repo.completeAgentRun(runId, { status, ...partials }).catch(() => undefined);
    await this.repo.saveRunTrace(runId, minimalTrace).catch(() => undefined);
  }
  this.container.runBus.complete(runId);  // always fires
}
```

`runBus.complete(runId)` must be outside the `if (!runCompleted)` guard — the UI SSE stream
must be released even if both DB writes fail.

## Pattern 3: `partialCostKnown` boolean flag

`null` is ambiguous: it means both "LLM never returned" and "LLM returned but model has no
pricing entry". Without a flag, `partialCostUsd ?? undefined` in the catch branch cannot
distinguish the two cases, and `completeAgentRun`'s conditional spread writes NULL for both.

The flag makes intent explicit:

```typescript
costUsd: partialCostKnown ? partialCostUsd : undefined
// ↑ writes null (known-null) or undefined (skip write)
```

`completeAgentRun` uses `...(values.costUsd !== undefined ? { costUsd: values.costUsd } : {})`
so `undefined` means "do not touch the column" and `null` means "write NULL".

## Workspace scoping on every query

Every DB query in this module must include a `workspaceId` filter. The `costRows` aggregate
in `GET /repos/:id/pulls` was missing this filter — it was safe because `prIds` were already
workspace-scoped, but it violated the invariant and becomes a real bug if the query source
ever changes.
