import type { FastifyInstance } from 'fastify';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { BlastService } from './service.js';

/**
 * A3 — Blast-radius module (L04, §12).
 *   GET /pulls/:id/blast → BlastRadius (changed symbols + downstream callers
 *                          + endpoints/crons affected + summary)
 */
export default async function blastRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new BlastService(container);

  app.get<{ Params: { id: string } }>('/pulls/:id/blast', async (req): Promise<BlastRadius> => {
    const { workspaceId } = await getContext(container, req);
    return service.forPull(workspaceId, req.params.id);
  });
}
