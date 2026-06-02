import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConformanceInput } from '@devdigest/shared/contracts/eval-ci';
import { getContext } from '../_shared/context.js';
import { ConformanceService } from './service.js';

/**
 * A4 — PRD ↔ PR Conformance (§12, owner A4).
 *   POST /pulls/:id/conformance   → run a fresh 3-column report, persist it
 *   GET  /pulls/:id/conformance   → latest persisted report (?spec= to pick one)
 */
export default async function conformanceRoutes(app: FastifyInstance) {
  const service = new ConformanceService(app.container);

  app.post<{ Params: { id: string } }>('/pulls/:id/conformance', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = ConformanceInput.parse(req.body ?? {});
    return service.run(workspaceId, req.params.id, input);
  });

  const Query = z.object({ spec: z.string().optional() });

  app.get<{ Params: { id: string } }>('/pulls/:id/conformance', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = Query.parse(req.query ?? {});
    const report = await service.latest(workspaceId, req.params.id, q.spec);
    if (!report) {
      reply.code(404);
      return { error: { code: 'not_found', message: 'No conformance report yet for this PR' } };
    }
    return report;
  });
}
