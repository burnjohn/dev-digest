# Server Architecture

## Request Flow

```
HTTP Request
  → middleware (helmet, cors, rate-limit)
  → Zod schema validation (params / body / response)
  → module route handler (src/modules/<name>/routes.ts)
  → service (src/modules/<name>/service.ts)
  → platform/container.ts (DI)
  → adapter (port implementation)
  → external: Postgres / GitHub / LLM API / git
```

Validation rejects malformed input with `422` before the handler runs. Response schemas are also validated — a handler cannot return an undeclared shape.

## Dependency Injection

`platform/container.ts` is the single DI container. It wires all adapters at startup and exposes them to services. Services receive dependencies via constructor:

```typescript
class ReviewService {
  constructor(
    private db: Db,
    private llm: LLMProvider,
    private github: GitHubClient,
    private secrets: SecretsProvider,
    private reviewerCore: ReviewerCore,
    private runBus: RunBus,
  ) {}
}
```

In tests, `src/adapters/mocks.ts` provides drop-in stubs for every port. Pass mocks to the constructor — no monkey-patching, no module-level mocks.

## Adapter Ports

| Port | Interface | Production impl | Test impl |
|------|-----------|----------------|-----------|
| `LLMProvider` | `.complete(messages)` | OpenAI / Anthropic / OpenRouter | `MockLLMProvider` |
| `GitHubClient` | `.getPullRequest()`, `.getDiff()` | Octokit | `MockGitHubClient` |
| `GitClient` | `.clone()`, `.checkout()` | simple-git | `MockGitClient` |
| `Embedder` | `.embed(text)` | OpenAI embeddings | `MockEmbedder` |
| `SecretsProvider` | `.get(key)` | `LocalSecretsProvider` | `MockSecretsProvider` |
| `CodeIndex` | `.search(query)` | ripgrep | `MockCodeIndex` |

## SecretsProvider — Single Chokepoint

`LocalSecretsProvider` is the **only** place in the entire codebase that reads `process.env` or `~/.devdigest/secrets.json`. All other code receives secrets through the injected `SecretsProvider`. This makes secret access auditable and testable.

## SSE & RunBus

Review runs are asynchronous. `POST /pulls/:id/review` returns `{ runId }` immediately. The UI subscribes to `GET /runs/:id/events` (SSE).

```
ReviewService.run()
  → emits RunEvent objects into RunBus (platform/sse.ts)
  → RunBus fans out to all SSE connections for that runId
  → client receives progress, log lines, completion event
```

`RunBus` is in-memory. It is not persisted and not shared across processes. A server restart clears all active streams.

## Database Schema

Drizzle ORM + PostgreSQL + pgvector. Tables are pre-defined for all course lessons — many are empty stubs today.

**Active tables:** `repos`, `pulls`, `reviews`, `findings`, `agents`, `runs`
**Future (pre-defined, empty):** `skills`, `memory_items`, `eval_cases`, `eval_runs`, `blast_radius`, `conventions`, `intents`, `smart_diffs`, `ci_runs`

Migrations live in `drizzle/`. Rules:
- Never edit an existing migration file
- Schema change → `pnpm db:generate` → `pnpm db:migrate`
- Migrations never run automatically on boot

## Rate Limiting

`POST /pulls/:id/review` — 120 requests/min globally (tight because each call hits an LLM API).
Rate limiting is disabled in test mode (`NODE_ENV=test`).
