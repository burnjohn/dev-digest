# Validation Stack

Each layer validates what it owns. Validation is not duplicated across layers — each check belongs in exactly one place.

---

## The Stack

```
┌─────────────────────────────────────────────────────────────────┐
│  HTTP Transport  (routes.ts)                                    │
│  Zod schema + fastify-type-provider-zod                         │
│  "Is the HTTP payload shaped correctly?"                        │
│  → wrong shape = 422 Unprocessable Entity (auto)               │
├─────────────────────────────────────────────────────────────────┤
│  Application  (service.ts)                                      │
│  z.safeParse() or guard clauses                                 │
│  "Are business preconditions met?"                              │
│  → violation = throw AppError(..., 422) / NotFoundError         │
├─────────────────────────────────────────────────────────────────┤
│  Domain  (entities, contracts)                                  │
│  Plain TypeScript guard clauses                                 │
│  "Are domain invariants intact?"                                │
│  → violation = throw AppError('invariant_violated', ...)        │
├─────────────────────────────────────────────────────────────────┤
│  Database  (Drizzle schema + PostgreSQL)                        │
│  .notNull(), .unique(), CHECK constraints                       │
│  "Is the data safe to store?"                                   │
│  → violation = Drizzle throws, caught by error handler          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: HTTP Transport — Zod + fastify-type-provider-zod

**What it validates:** wire format (types, required fields, string lengths, enum membership for HTTP)

**Where it lives:** top of `routes.ts` or `modules/_shared/schemas.ts`

```typescript
// routes.ts
const CreateAgentBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string().min(1),
  system_prompt: z.string().optional(),
});

fastify.post('/agents', {
  schema: { body: CreateAgentBody },  // ← registered here
}, handler);
// fastify-type-provider-zod auto-validates; handler never receives invalid input
```

**Rule:** HTTP schemas validate shape only — no business rules here (e.g., not "name must be unique").

---

## Layer 2: Application — Business Preconditions

**What it validates:** business rules that require data lookups or cross-field logic

**Where it lives:** service method body, before the main operation

```typescript
// service.ts
async linkSkill(workspaceId: string, agentId: string, skillId: string) {
  // ✅ Application-level precondition: requires a DB lookup to check
  const existing = await this.repo.linkedSkills(agentId);
  if (existing.length >= 10) {
    throw new AppError('skill_limit_exceeded', 'Max 10 skills per agent', 422);
  }

  // ✅ Existence check: NotFoundError is an application concern
  const agent = await this.repo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError(`Agent ${agentId}`);

  await this.repo.linkSkill(agentId, skillId);
}
```

For simple structural checks, `z.safeParse()` is acceptable in services:

```typescript
// ✅ OK in service for complex conditional shape validation
const result = CreateReviewInput.safeParse(input);
if (!result.success) throw new ValidationError('Invalid review input', result.error.flatten());
```

---

## Layer 3: Domain — Invariant Guards

**What it validates:** rules that are inherently true about a concept, independent of context

**Where it lives:** entity static constructors or domain service functions

```typescript
// domain entity
static create(params: { severity: string }): Finding {
  const valid = ['critical', 'high', 'medium', 'low', 'info'];
  if (!valid.includes(params.severity)) {
    // ✅ Plain guard — no Zod import
    throw new AppError('invalid_severity', `"${params.severity}" is not valid`, 422);
  }
  return new Finding(params);
}
```

**Rule:** NO Zod in domain layer. Guard clauses only. The domain must be usable without any external library.

---

## Layer 4: Database — Integrity Constraints

**What it validates:** data integrity at rest (last defense)

**Where it lives:** Drizzle schema definition (`db/schema/*.ts`)

```typescript
// db/schema/agents.ts
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  name: text('name').notNull(),
  model: text('model').notNull(),
  // NOT NULL, FK reference = DB-level constraints
});
```

DB constraints are the safety net — they catch bugs in code that bypassed higher layers. They are not a substitute for application validation.

---

## Anti-Patterns

```typescript
// ❌ Duplicating validation across layers
// routes.ts validates: name.max(120)
// service.ts re-validates: if (name.length > 120) throw ...
// → pick ONE place; HTTP schema is sufficient for length checks

// ❌ Business rules in HTTP schema
const CreateAgentBody = z.object({
  name: z.string().refine(async (n) => {
    const exists = await db.select()...  // BAD — DB call in Zod schema
    return !exists;
  }),
});

// ❌ Zod in domain entities
import { z } from 'zod';  // BAD — domain must not depend on external libs
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
```

---

## Quick Reference

| Question | Answer | Layer |
|---|---|---|
| Is the JSON body the right shape? | Zod schema in `routes.ts` | Presentation |
| Does this agent exist? | `NotFoundError` in `service.ts` | Application |
| Is the user allowed to do this? | Guard in `service.ts` | Application |
| Is this severity value valid? | Guard clause in domain | Domain |
| Is the FK valid? | `references()` in Drizzle schema | DB |
| Is this field unique? | `.unique()` in Drizzle schema | DB |
