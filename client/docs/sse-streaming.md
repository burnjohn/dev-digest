# SSE Streaming — Live Run Progress

The API pushes run events over Server-Sent Events so the UI can show real-time progress
without polling.

## Server endpoint

`GET /workspaces/:workspaceId/runs/:runId/events`

The Fastify route writes `text/event-stream` — each event is a JSON line:

```
data: {"type":"run:log","payload":{"line":"Calling LLM...","ts":1719480000000}}\n\n
data: {"type":"run:complete","payload":{"status":"done","score":0.82}}\n\n
```

Event types: `run:log`, `run:complete`, `run:error`.

## `runBus` — in-memory broker

`container.runBus` is a plain Node.js `EventEmitter`. The SSE handler subscribes to events
keyed by `runId` and forwards them to the HTTP response stream. When `runBus.complete(runId)`
fires (success or error), the handler closes the SSE connection.

**Architectural limitation:** `runBus` is in-process only. A client connected to API instance A
will not receive events from a review running on instance B. Horizontal scaling requires
replacing `runBus` with Redis Pub/Sub or a similar external bus.

## Client-side consumption

The client opens an `EventSource` pointing at the events endpoint. The hook (`useRunEvents` or
equivalent) processes incoming events:

1. Appends `run:log` lines to local state for the activity feed
2. On `run:complete` — invalidates TanStack Query cache for the run record and the PR's run
   list so the UI reflects the final state without a full page reload

```typescript
queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) });
queryClient.invalidateQueries({ queryKey: pullKeys.runs(prId) });
```

## Connection lifecycle

- `EventSource` is opened when the run card enters the viewport (or on explicit "watch" action)
- Closed automatically when `run:complete` or `run:error` arrives
- If the user navigates away before completion the browser closes the connection; the Fastify
  route cleans up the `runBus` listener via the `reply.raw.on('close', cleanup)` handler

## Relation to TanStack Query

SSE is the notification channel only — it does not carry the full updated run object.
On `run:complete`, `invalidateQueries` triggers a normal REST fetch for the fresh run data.
This keeps the SSE payload minimal and avoids duplicating server-side serialization logic.
