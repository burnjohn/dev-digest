import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WebhookSubscriptionInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { WebhookService } from './service.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Webhooks module. Lets a workspace register an outbound endpoint and manage
 * its active subscriptions.
 *   POST   /webhooks              → register a subscription
 *   GET    /webhooks/:id/status   → last delivery status for a subscription
 */
export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhookService(app.container);

  app.post('/webhooks', { schema: { body: WebhookSubscriptionInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.publish(workspaceId, { event: 'subscription.created', workspaceId, data: req.body });
    reply.status(201);
    return { registered: true };
  });

  app.get('/webhooks/:id/status', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await app.container.db
      .select({ status: t.webhookSubscriptions.lastDeliveryStatus })
      .from(t.webhookSubscriptions)
      .where(eq(t.webhookSubscriptions.id, id));
    return row ?? { status: 'unknown' };
  });
}
