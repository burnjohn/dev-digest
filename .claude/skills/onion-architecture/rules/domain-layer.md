# Domain Layer

The innermost layer. Contains business concepts that are true regardless of framework, database, or transport protocol.

---

## What Lives Here

### 1. Contract Types (`vendor/shared/contracts/`)

Pure TypeScript interfaces and types shared across the stack. These ARE the domain model for DevDigest:

```typescript
// vendor/shared/contracts/findings.ts
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Verdict = 'confirmed' | 'dismissed' | 'pending';

export interface Finding {
  id: string;
  severity: Severity;
  verdict: Verdict;
  title: string;
  body: string;
  file?: string;
  line?: number;
}
```

These types flow in both directions — server uses them in service/repo, client imports them for type safety.

### 2. Domain Errors

Extend from `AppError` (already in `src/platform/errors.ts`):

```typescript
// For new domain error types
import { AppError } from '../../platform/errors';

export class InvalidSeverityError extends AppError {
  constructor(value: string) {
    super('invalid_severity', `"${value}" is not a valid severity`, 422);
  }
}
```

The existing error classes (`NotFoundError`, `ValidationError`, `ExternalServiceError`) cover most cases — reach for a new domain error only when the existing set doesn't express the business rule.

### 3. Domain Services (Pure Computation)

Stateless functions that implement business rules with no I/O:

```typescript
// Example: computing aggregate severity from a list of findings
export function computeAggregateSeverity(findings: Finding[]): Severity {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  for (const level of order) {
    if (findings.some(f => f.severity === level)) return level;
  }
  return 'info';
}
```

---

## The Zero-Import Rule

Domain files must have **zero imports from framework packages**:

```typescript
// ❌ ALL of these are forbidden in vendor/shared/contracts/ or domain entities
import { eq } from 'drizzle-orm';
import { FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodSchema } from 'zod';
import { Container } from '../../platform/container';
import postgres from 'postgres';
```

If you find yourself wanting to add one of these — the code you're writing belongs in a different layer.

---

## Validation in the Domain Layer

Domain validation uses **plain guard clauses**, not Zod:

```typescript
// ✅ CORRECT — domain guard, no external dependency
function assertValidSeverity(value: string): asserts value is Severity {
  const valid = ['critical', 'high', 'medium', 'low', 'info'];
  if (!valid.includes(value)) {
    throw new AppError('invalid_severity', `Invalid severity: ${value}`, 422);
  }
}

// ❌ WRONG — Zod in domain
import { z } from 'zod';
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
// This couples domain to an external library; doesn't belong here
```

**Why:** Zod is an infrastructure/presentation tool. Domain invariants should be expressible without it. If a Zod enum is needed for HTTP serialization, define it in `presentation/schemas/` or `_shared/schemas.ts` and derive it from the domain type.

---

## Entity Pattern (When Needed)

For concepts that need invariant enforcement at construction time:

```typescript
export class AgentVersion {
  private constructor(
    public readonly agentId: string,
    public readonly version: number,
    public readonly config: AgentConfig,
  ) {}

  static create(params: { agentId: string; version: number; config: unknown }): AgentVersion {
    if (params.version < 1) {
      throw new AppError('invalid_version', 'Version must be >= 1', 422);
    }
    // validate config shape with a plain check, not Zod
    return new AgentVersion(params.agentId, params.version, params.config as AgentConfig);
  }
}
```

Private constructor forces all creation through `create()`, which enforces invariants. The repository's `toDomain()` calls `Entity.create()`.

Note: Most DevDigest "entities" are currently plain interfaces in `vendor/shared/contracts/`. Full entity classes are only needed when invariants need to be enforced at construction time.
