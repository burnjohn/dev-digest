import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { RunProgressService } from './service.js';

/**
 * Run-progress module. Read-only status for a run's latest checkpoint —
 * separate from the SSE stream, for clients that just want a poll-friendly
 * snapshot (e.g. a CI job waiting on completion).
 *   GET /runs/:id/progress → latest checkpoint
 */
export default async function runProgressRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RunProgressService(app.container);

  app.get('/runs/:id/progress', { schema: { params: IdParams } }, async (req) => {
    await getContext(app.container, req);
    return service.status(req.params.id);
  });
}
