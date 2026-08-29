import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { TagInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { TagService } from './service.js';

/**
 * Tags module. Freeform workspace-scoped labels a user can attach to a repo
 * for their own filtering — distinct from GitHub labels.
 *   GET  /tags   → list tags for the workspace
 *   POST /tags   → create a tag
 */
export default async function tagsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new TagService(app.container);

  app.get('/tags', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/tags', { schema: { body: TagInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const tag = await service.create(workspaceId, req.body.name);
    reply.status(201);
    return tag;
  });
}
