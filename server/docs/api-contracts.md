# API Contracts

Base URL: `http://localhost:3001`

All routes use `fastify-type-provider-zod`. Every input and output is validated by Zod schemas defined in `src/vendor/shared/` (the `@devdigest/shared` package).

## Routes

### Repos

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos` | List all repos |
| `POST` | `/repos` | Add a repo (by GitHub URL or local path) |
| `GET` | `/repos/:id` | Get repo details |

### Pulls

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos/:repoId/pulls` | List PRs for a repo |
| `POST` | `/repos/:repoId/pulls/import` | Import PRs from GitHub |
| `GET` | `/pulls/:id` | Get PR details (with diff) |
| `POST` | `/pulls/:id/review` | Start a review run → returns `{ runId }` |

Rate limit: `POST /pulls/:id/review` — 120/min globally.

### Reviews & Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pulls/:id/reviews` | List reviews for a PR |
| `GET` | `/reviews/:id` | Get review with findings |
| `GET` | `/runs/:id/events` | SSE stream of `RunEvent` objects |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents |
| `POST` | `/agents` | Create agent |
| `PUT` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |

### Repo Intel

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repos/:id/index` | Trigger symbol/import indexing |
| `GET` | `/repos/:id/map` | Get repo map (for review context) |

### Settings & Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Get current settings (providers, models) |
| `PUT` | `/settings` | Update settings |
| `GET` | `/workspace` | Workspace status |

## SSE Protocol — `GET /runs/:id/events`

The client subscribes with `EventSource`. The server emits `RunEvent` objects as newline-delimited JSON in the `data` field of each SSE message.

```typescript
// RunEvent union — defined in @devdigest/shared
type RunEvent =
  | { type: "started";   runId: string }
  | { type: "log";       runId: string; message: string }
  | { type: "progress";  runId: string; step: string; percent: number }
  | { type: "completed"; runId: string; reviewId: string }
  | { type: "failed";    runId: string; error: string }
```

Connection closes automatically on `completed` or `failed`.

## Zod Schema Locations

All schemas are in `server/src/vendor/shared/`. Key files:

| File | Contains |
|------|---------|
| `review.ts` | `Review`, `Finding`, `Severity`, `Verdict` |
| `agent.ts` | `Agent`, `CreateAgentBody` |
| `repo.ts` | `Repo`, `Pull` |
| `settings.ts` | `Settings`, `LLMProvider` enum |
| `run.ts` | `Run`, `RunEvent` |

## Error Format

All errors return:
```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "..." }
```

Zod validation failures return `422` with the full Zod error tree in `message`.
