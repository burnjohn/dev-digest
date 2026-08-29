import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { LabelService } from './service.js';

/**
 * Labels module. Read + on-demand sync of a repo's GitHub labels.
 *   GET  /repos/:id/labels        → list cached labels
 *   POST /repos/:id/labels/sync   → trigger a GitHub sync
 */
export default async function labelsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new LabelService(app.container);

  app.get('/repos/:id/labels', { schema: { params: IdParams } }, async (req) => {
    await getContext(app.container, req);
    return service.list(req.params.id);
  });

  app.post('/repos/:id/labels/sync', { schema: { params: IdParams } }, async (req) => {
    await getContext(app.container, req);
    return service.sync(req.params.id, req.body as unknown as string);
  });
}
