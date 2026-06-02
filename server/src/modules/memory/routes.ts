import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MemoryScope, MemoryKind, MemorySource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { MemoryService } from './service.js';

/**
 * A1 — memory module (§12, owner A1/A5).
 *   GET    /memory?scope&kind&q&freshness&repoId  → list (filterable)
 *   POST   /memory                                → embed + store
 *   PATCH  /memory/:id                            → update (re-embed on content)
 *   DELETE /memory/:id                            → delete
 *
 * The reusable `retrieveMemory` / `learnFromFinding` helpers live on
 * MemoryService (constructed from the container) so A2/A5 can call them without
 * an HTTP round-trip.
 */

const CreateMemoryBody = z.object({
  content: z.string().min(1),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(MemorySource).optional(),
  repo_id: z.string().uuid().nullish(),
});

const UpdateMemoryBody = z.object({
  content: z.string().min(1).optional(),
  scope: MemoryScope.optional(),
  kind: MemoryKind.optional(),
  confidence: z.number().min(0).max(1).optional(),
});

function csv<T extends string>(value: string | undefined, schema: z.ZodType<T>): T[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: T[] = [];
  for (const p of parts) {
    const r = schema.safeParse(p);
    if (r.success) out.push(r.data);
  }
  return out.length > 0 ? out : undefined;
}

export default async function memoryRoutes(app: FastifyInstance) {
  const service = new MemoryService(app.container);

  app.get<{
    Querystring: { scope?: string; kind?: string; q?: string; freshness?: string; repoId?: string };
  }>('/memory', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { scope, kind, q, freshness, repoId } = req.query;
    return service.list(workspaceId, {
      scope: csv(scope, MemoryScope),
      kind: csv(kind, MemoryKind),
      q,
      // freshness=fresh → hide stale (>60d); default/all → include
      includeStale: freshness === 'fresh' ? false : true,
      ...(repoId ? { repoId } : {}),
    });
  });

  app.post('/memory', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = CreateMemoryBody.parse(req.body);
    const dto = await service.create(workspaceId, {
      content: body.content,
      scope: body.scope,
      kind: body.kind,
      confidence: body.confidence ?? null,
      sources: body.sources,
      repoId: body.repo_id ?? null,
    });
    reply.status(201);
    return dto;
  });

  app.patch<{ Params: { id: string } }>('/memory/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const patch = UpdateMemoryBody.parse(req.body);
    const dto = await service.update(workspaceId, req.params.id, patch);
    if (!dto) throw new NotFoundError('Memory item not found');
    return dto;
  });

  app.delete<{ Params: { id: string } }>('/memory/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.remove(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Memory item not found');
    return { deleted: req.params.id };
  });
}
