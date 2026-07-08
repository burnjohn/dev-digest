# API Contracts

Conventions every route in `server/src/modules/*/routes.ts` must follow. Read this before adding
or changing an endpoint.

## Route shape

A route file is a `FastifyPluginAsync` exporting a default function; it owns every route for its
domain. Registration is static — see [../src/modules/AGENTS.md](../src/modules/AGENTS.md).

```ts
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });
}
```

- `withTypeProvider<ZodTypeProvider>()` — one Zod schema drives both runtime validation and the
  TS type of `req.params` / `req.body`. Never hand-type a handler's request shape.
- Route handlers call into a `service.ts` (business logic) or `repository.ts` (DB) — never inline
  a DB query or a multi-step operation in the handler itself.

## Param / body validation

| Case | Schema |
|---|---|
| `:id` addresses a DB row (uuid primary key) | `IdParams` from [`../src/modules/_shared/schemas.ts`](../src/modules/_shared/schemas.ts) — `z.object({ id: z.string().uuid() })` |
| `:id` is NOT a uuid (e.g. a provider name like `openai`) | Define a route-local schema — do not reuse `IdParams` |
| Request body | An inline `z.object({...})` in the route's `schema.body`, or a shared contract type from `@devdigest/shared` (e.g. `RunRequest`) |

An invalid uuid in `:id` becomes a clean `422` at the schema layer — it never reaches the
service or the DB.

## Tenancy — workspace scoping is mandatory

Every route that reads or writes a workspace-owned row starts with:

```ts
const { workspaceId } = await getContext(container, req);
```

`getContext()` ([`../src/modules/_shared/context.ts`](../src/modules/_shared/context.ts)) resolves
the current user + workspace via `container.auth`. Every repository query the route calls into
**must** filter by that `workspaceId` — this is enforced as a hard rule in
[`../src/modules/AGENTS.md`](../src/modules/AGENTS.md), not just a convention. A route missing
this scoping is a cross-tenant data leak, not a style nit.

## Error handling

Throw a typed `AppError` subclass from [`../src/platform/errors.ts`](../src/platform/errors.ts) —
never a raw `Error` or string. Fastify's error handler turns it into the stable envelope
`{ error: { code, message, details } }`.

| Class | HTTP status | Use for |
|---|---|---|
| `NotFoundError` | 404 | row not found / not visible to this workspace |
| `ValidationError` | 422 | body/params fail a check the Zod schema itself can't express |
| `ExternalServiceError` | 502 | a downstream call (GitHub, LLM provider) failed |
| `ConfigError` | 500 | missing/invalid server configuration |

```ts
const review = await service.getReview(workspaceId, req.params.id);
if (!review) throw new NotFoundError('Review not found');
return review;
```

## Rate limiting

Add `config: { rateLimit: { max, timeWindow } }` to routes that can trigger expensive work (LLM
calls, fan-out). Two patterns exist:

- **Per-IP (default)** — `{ max: 10, timeWindow: '1 minute' }`, e.g. `POST /pulls/:id/review`.
- **Per-workspace** — supply a `keyGenerator` that resolves `workspaceId` via `getContext()` first,
  e.g. `POST /pulls/:id/brief` in [`../src/modules/reviews/routes.ts`](../src/modules/reviews/routes.ts).
  Use this when the same IP can legitimately represent many workspaces (not the case for MVP's
  single-tenant auth, but the pattern exists — copy it, don't invent a new one).

Reads and zero-cost writes (e.g. `DELETE /pulls/:id/brief`) do not need a rate limit.

## SSE (streaming) routes

`GET /runs/:id/events` is the only SSE route; it sets `config: { rateLimit: false }` (a long-lived
connection is not burst traffic) and bridges an in-process event bus to `reply.sse()`. Copy this
pattern only for genuinely long-lived server-push endpoints — not for anything that returns once.

## Background / fire-and-forget routes

`POST /repos/:id/review-all` is the reference pattern for a route that returns immediately while
work continues after the response:

- Detach a **child logger** (`req.log.child({...})`) *before* returning — Fastify recycles `req`
  once the handler returns, so `req.log` is invalid inside code that runs after the response.
- Cap concurrency explicitly (see the `scheduleNext()` pattern) — don't let fan-out saturate the
  LLM provider's rate limit.
- Guard against duplicate work (e.g. skip PRs that already have a `running` `agent_runs` row)
  before scheduling.

## Adding a new endpoint — checklist

1. Route lives in the right module's `routes.ts` (or a new module — see
   [`../src/modules/AGENTS.md`](../src/modules/AGENTS.md) for scaffolding a module).
2. `params`/`body` validated via a Zod schema (`IdParams` or route-local).
3. `getContext()` called before any workspace-owned read/write; every downstream query filtered
   by `workspaceId`.
4. Errors thrown as a typed `AppError` subclass, never a raw `Error`.
5. Rate limit added if the route can trigger LLM calls or fan-out.
6. Business logic in `service.ts`, DB access in `repository.ts` — the route handler stays thin.
