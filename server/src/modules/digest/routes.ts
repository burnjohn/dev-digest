import type { FastifyInstance } from 'fastify';
import { getContext } from '../_shared/context.js';
import { DigestRunRequest } from '@devdigest/shared';
import { DigestService } from './service.js';
import { WEEKLY_DIGEST_JOB } from './constants.js';

/**
 * A6 — Weekly Digest (§12, owner A6).
 *   GET  /digest        → list persisted digests (newest first)
 *   POST /digest/run    → build a digest now (default: last 7 days)
 *
 * Registers a `weekly_digest` JobRunner handler so a scheduler (server
 * bootstrap / cron) can build digests on a cadence. A5's `memory_curate` job
 * is likewise schedulable; both are enqueued by the optional scheduler.
 */
export default async function digestRoutes(app: FastifyInstance) {
  const service = new DigestService(app.container);

  app.container.jobs.register(WEEKLY_DIGEST_JOB, async (payload) => {
    const { workspaceId } = payload as { workspaceId: string };
    await service.run(workspaceId);
  });

  app.get('/digest', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/digest/run', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = DigestRunRequest.parse(req.body ?? {});
    return service.run(workspaceId, {
      start: body.period_start ? new Date(body.period_start) : undefined,
      end: body.period_end ? new Date(body.period_end) : undefined,
    });
  });
}
