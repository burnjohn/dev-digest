# Presentation Layer

`modules/*/routes.ts` — the outermost layer. Fastify plugins that translate HTTP to/from the application layer.

---

## The Three-Step Rule

Every route handler does **exactly three things**:

```typescript
// 1. Validate   — enforced by fastify-type-provider-zod via schema option
// 2. Orchestrate — call ONE service method
// 3. Respond    — send the result

fastify.post('/agents', {
  schema: { body: CreateAgentBody, response: { 201: AgentResponse } },
}, async (req, reply) => {
  const { workspaceId } = await getContext(container, req);          // 1. resolve context
  const agent = await service.create(workspaceId, req.body);        // 2. delegate to service
  return reply.status(201).send(agent);                             // 3. respond
});
```

If the handler has `if/else` branching, loops, or multiple service calls — extract to the service layer.

---

## Route File Anatomy

```typescript
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Container } from '../../platform/container';
import { getContext } from '../_shared/context';
import { AgentService } from './service';

// HTTP-ONLY Zod schemas at the top of the file
const CreateAgentBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string(),
});

const AgentIdParams = z.object({
  id: z.string(),
});

const AgentResponse = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  created_at: z.string(),
});

export const agentsRoutes: FastifyPluginAsync<{ container: Container }> = async (
  fastify,
  { container },
) => {
  const service = new AgentService(container);

  fastify.post('/agents', {
    schema: { body: CreateAgentBody, response: { 201: AgentResponse } },
  }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const agent = await service.create(workspaceId, req.body);
    return reply.status(201).send(agent);
  });

  fastify.get('/agents/:id', {
    schema: { params: AgentIdParams, response: { 200: AgentResponse } },
  }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const agent = await service.getById(workspaceId, req.params.id);
    return reply.send(agent);
  });
};
```

---

## Zod Schemas in Routes

HTTP Zod schemas describe the **wire shape**, not domain types. They live at the top of `routes.ts` or in `_shared/schemas.ts` when shared across routes:

```typescript
// ✅ HTTP schema — validates shape of the HTTP body
const CreateAgentBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string(),
});

// ✅ Shared across routes — lives in modules/_shared/schemas.ts
export const IdParams = z.object({ id: z.string() });

// ❌ WRONG — domain invariant validation in an HTTP schema
const CreateAgentBody = z.object({
  name: z.string().regex(/^[a-z-]+$/, 'Must be lowercase kebab'),  // This is a business rule
  // → belongs in service validation or entity guard, not HTTP schema
});
```

---

## Error Propagation

Routes never catch `AppError` themselves — the global error handler in `app.ts` handles it:

```typescript
// ✅ CORRECT — let errors propagate
fastify.delete('/agents/:id', { schema: { params: IdParams } }, async (req, reply) => {
  const { workspaceId } = await getContext(container, req);
  await service.deleteById(workspaceId, req.params.id);  // throws NotFoundError if missing
  return reply.status(204).send();
});

// ❌ WRONG — catching and re-throwing manually
fastify.delete('/agents/:id', { ... }, async (req, reply) => {
  try {
    await service.deleteById(workspaceId, req.params.id);
  } catch (err) {
    if (err instanceof NotFoundError) return reply.status(404).send({ error: 'not found' });
    throw err;
  }
});
```

The global handler maps `AppError` subtypes to their status codes automatically.

---

## Context Extraction

Always the first line of every handler:

```typescript
const { workspaceId, userId } = await getContext(container, req);
```

`getContext()` is in `modules/_shared/context.ts`. It extracts workspace + user from the request (auth header / workspace header) and validates they exist. Never extract `workspaceId` from `req.headers` manually in handlers.

---

## What NEVER Goes in a Route Handler

```typescript
// ❌ Business logic
if (agent.type === 'review' && skills.length > 5) { ... }

// ❌ Repository access (skipping service)
const repo = new AgentsRepository(container.db);
const agents = await repo.list(workspaceId);

// ❌ Adapter access
const llm = await container.llm('openai');
const result = await llm.complete({ prompt });

// ❌ Raw SQL or Drizzle
const rows = await container.db.select().from(t.agents)...

// ❌ Multi-step orchestration
const agent = await service.get(id);
const runs = await runsService.list(agent.id);
const enriched = { ...agent, runs };  // compose in service, not route
```
