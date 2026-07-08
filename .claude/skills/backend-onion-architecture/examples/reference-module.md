# Reference Module — Annotated Example

A complete, working example of a new module following the Onion Architecture standard.  
**Domain:** `digests` — a feature that stores and retrieves activity digest records per workspace.

---

## 1. Directory

```
server/src/modules/digests/
├── routes.ts
├── service.ts
├── repository.ts
└── helpers.ts
```

---

## 2. `helpers.ts` — DTOs and types

Define input/output shapes here. No side effects; no imports from service or repository.

```typescript
// server/src/modules/digests/helpers.ts
import { z } from 'zod';

// Input DTO (matches HTTP request body)
export const CreateDigestSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().optional(),
  repoId: z.string().uuid(),
});
export type CreateDigestDto = z.infer<typeof CreateDigestSchema>;

// Output DTO (returned by service, serialized by route)
export interface DigestDto {
  id: string;
  title: string;
  summary: string | null;
  repoId: string;
  workspaceId: string;
  createdAt: Date;
}
```

---

## 3. `repository.ts` — Infrastructure layer

Drizzle queries only. No business logic. Every query scoped by `workspace_id`.

```typescript
// server/src/modules/digests/repository.ts
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { DigestDto } from './helpers.js';

export class DigestsRepository {
  constructor(private db: Db) {} // receives db — NOT Container

  async findById(id: string, workspaceId: string): Promise<DigestDto | null> {
    const rows = await this.db
      .select()
      .from(t.digests)
      .where(
        and(
          eq(t.digests.id, id),
          eq(t.digests.workspaceId, workspaceId), // MANDATORY — data isolation
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listByRepo(repoId: string, workspaceId: string): Promise<DigestDto[]> {
    return this.db
      .select()
      .from(t.digests)
      .where(
        and(
          eq(t.digests.repoId, repoId),
          eq(t.digests.workspaceId, workspaceId), // MANDATORY
        ),
      )
      .orderBy(desc(t.digests.createdAt));
  }

  async insert(data: {
    title: string;
    summary?: string;
    repoId: string;
    workspaceId: string;
  }): Promise<DigestDto> {
    const rows = await this.db
      .insert(t.digests)
      .values(data)
      .returning();
    return rows[0];
  }
}
```

---

## 4. `service.ts` — Application layer

Business logic and orchestration. Receives `Container`; never imports concrete adapters.

```typescript
// server/src/modules/digests/service.ts
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { DigestsRepository } from './repository.js';
import type { CreateDigestDto, DigestDto } from './helpers.js';

export class DigestsService {
  private repo: DigestsRepository;

  constructor(private container: Container) {
    // Repositories are OK to instantiate directly with container.db
    this.repo = new DigestsRepository(container.db);
  }

  async getById(id: string, workspaceId: string): Promise<DigestDto> {
    const digest = await this.repo.findById(id, workspaceId);
    if (!digest) throw new NotFoundError(`Digest ${id} not found`);
    return digest;
  }

  async create(dto: CreateDigestDto, workspaceId: string): Promise<DigestDto> {
    // Business validation — domain rule, not HTTP concern
    if (!dto.title.trim()) throw new ValidationError('Digest title cannot be blank');

    // External adapters accessed only via container — never: new OctokitGitHubClient(...)
    const github = await this.container.github();
    const repo = await github.getRepository(dto.repoId); // verify repo exists

    return this.repo.insert({
      title: dto.title,
      summary: dto.summary,
      repoId: dto.repoId,
      workspaceId, // always propagate workspace scope
    });
  }
}
```

---

## 5. `routes.ts` — Presentation layer

HTTP boundary only. Validates input, resolves workspace context, delegates to Service.

```typescript
// server/src/modules/digests/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { DigestsService } from './service.js';
import { CreateDigestSchema } from './helpers.js';

export default async function digestsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestsService(app.container); // Service gets Container

  // GET /digests/:id
  app.get('/digests/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getById(req.params.id, workspaceId);
    // No try/catch: AppError → Fastify error handler → ApiErrorBody JSON
  });

  // POST /digests
  app.post(
    '/digests',
    { schema: { body: CreateDigestSchema } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      // No business logic here — only validate, delegate, return
      const digest = await service.create(req.body, workspaceId);
      return reply.status(201).send(digest);
    },
  );
}
```

---

## 6. Register the module

Add exactly two lines to `modules/index.ts`:

```typescript
// server/src/modules/index.ts
import digests from './digests/routes.js'; // ← add import

export const modules: Record<string, FastifyPluginAsync> = {
  settings,
  repos,
  pulls,
  // ...existing modules...
  digests, // ← add entry
};
```

No other file needs to change.

---

## Layer responsibility summary

| File | Layer | Imports | Forbidden |
|---|---|---|---|
| `helpers.ts` | Shared | `zod`, TypeScript only | Anything with side effects |
| `repository.ts` | Infrastructure | `db/client`, `db/schema`, `./helpers` | `Container`, `service`, `adapters/` |
| `service.ts` | Application | `platform/container`, `platform/errors`, `./repository`, `./helpers` | Concrete adapters, HTTP concepts |
| `routes.ts` | Presentation | `platform/container`, `_shared/`, `./service`, `./helpers` | Business logic, DB queries |
