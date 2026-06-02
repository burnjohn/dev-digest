import type { FastifyInstance } from 'fastify';
import { getContext } from '../_shared/context.js';
import { PerformanceService } from './service.js';

/**
 * A6 — Agent Performance (§12, owner A6).
 *   GET /agents/performance → per-agent accept-rate / cost / latency aggregates.
 *
 * (Per-agent detail `GET /agents/:id/stats` is owned by A5's runs module.)
 */
export default async function performanceRoutes(app: FastifyInstance) {
  const service = new PerformanceService(app.container);

  app.get('/agents/performance', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.performance(workspaceId);
  });
}
