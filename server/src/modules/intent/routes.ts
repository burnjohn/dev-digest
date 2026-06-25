import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * intent module routes.
 *
 * GET  /pulls/:id/intent            → lazy compute-if-absent (supports R4 auto-load on Overview)
 * POST /pulls/:id/intent/recompute  → always re-computes (modest rate limit — one LLM call)
 *
 * Onion layer: presentation — thin handlers: getContext → one service call → reply.
 * No business logic here.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---- GET: lazy compute + return stored intent ---------------------------
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new IntentService(app.container, req.log);
      return service.getOrCompute(workspaceId, req.params.id);
    },
  );

  // ---- POST: force recompute ----------------------------------------------
  // Rate-limited like the review trigger route — each call fans out to an LLM.
  app.post(
    '/pulls/:id/intent/recompute',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new IntentService(app.container, req.log);
      const record = await service.recompute(workspaceId, req.params.id);
      reply.status(200);
      return record;
    },
  );
}
