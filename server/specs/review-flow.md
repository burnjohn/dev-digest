# Spec: Review Lifecycle

End-to-end trace of a single review run, from HTTP request to persisted findings.

## Trigger

```
POST /pulls/:id/review
Body: { agentId: string }
Response: { runId: string }   ← returned immediately, review runs async
```

## Step-by-Step

### 1. Route handler (`modules/reviews/routes.ts`)
- Validates `pullId` and `agentId` against DB (404 if not found)
- Creates a `Run` record in DB with `status: "pending"`
- Returns `{ runId }` to client
- Fires `ReviewService.run(pullId, agentId, runId)` — does not await

### 2. ReviewService.run()
Emits `{ type: "started" }` to RunBus.

**2a. Fetch context**
- Load `Pull` from DB (title, body, base/head SHAs)
- Fetch raw diff via `GitHubClient.getDiff()` or local `GitClient`
- Load `Agent` from DB (system prompt, model, provider)

**2b. Fetch repo map** (repo-intel)
- Call `CodeIndex.search()` for symbols referenced in the diff
- Build compact repo map string (file paths + exported symbols)

**2c. Invoke reviewer-core**
```typescript
const review = await reviewerCore.run({
  diff,
  systemPrompt: agent.systemPrompt,
  repoMap,
  llmProvider,   // injected, uses agent.provider + agent.model
})
```

### 3. reviewer-core pipeline
See `reviewer-core/docs/pipeline.md` for full detail.

Returns: `Review { verdict, score, findings[] }`

### 4. Persist results
- Insert `Review` row with `verdict` and `score`
- Insert `Finding` rows (each with `file`, `line`, `severity`, `message`, `diffQuote`)
- Update `Run` status to `"completed"`, set `reviewId`

### 5. SSE completion
Emits `{ type: "completed", runId, reviewId }` to RunBus. All connected SSE clients receive it and close their `EventSource`.

## Failure Path

Any unhandled error in `ReviewService.run()`:
- Updates `Run` status to `"failed"`, sets `error` field
- Emits `{ type: "failed", runId, error: message }` to RunBus
- Does **not** throw (async background job)

## Invariants

- `runId` is always returned before the review starts — the client must poll SSE to know when it is done
- `groundFindings()` runs inside reviewer-core before findings ever reach this service — only pre-grounded findings are persisted
- If `agentId` is not provided, the default agent (seed data) is used
