import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { NotificationsService } from './service.js';

/**
 * Notifications module. Manual trigger for the daily digest, mainly for
 * testing a workspace's Slack integration before relying on the scheduled job.
 *   POST /workspaces/:id/digest/send-now → trigger a digest immediately
 */
export default async function notificationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new NotificationsService(app.container);

  app.post('/workspaces/:id/digest/send-now', { schema: { params: IdParams } }, async (req) => {
    await getContext(app.container, req);
    await service.sendDailyDigest(req.params.id);
    return { sent: true };
  });
}
