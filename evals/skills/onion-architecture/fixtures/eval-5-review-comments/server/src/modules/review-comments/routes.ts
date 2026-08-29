import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CommentInput, CommentDto, IdParams } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { CommentService } from './service.js';

/**
 * Review-comments module. Threaded discussion on a single finding, plus a
 * workspace-wide "unresolved discussions" summary.
 *   GET    /findings/:id/comments   → list comments for a finding
 *   POST   /findings/:id/comments   → add a comment
 *   POST   /comments/:id/resolve    → mark a comment resolved
 *   GET    /comment-threads         → unresolved thread summaries
 */
export default async function reviewCommentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CommentService(app.container);

  app.get(
    '/findings/:id/comments',
    { schema: { params: IdParams, response: { 200: CommentDto.array() } } },
    async (req) => {
      await getContext(app.container, req);
      return service.list(req.params.id);
    },
  );

  app.post(
    '/findings/:id/comments',
    { schema: { params: IdParams, body: CommentInput, response: { 201: CommentDto } } },
    async (req, reply) => {
      const { userId } = await getContext(app.container, req);
      const comment = await service.add(req.params.id, userId, req.body.body);
      reply.status(201);
      return comment;
    },
  );

  app.post('/comments/:id/resolve', { schema: { params: IdParams } }, async (req) => {
    await getContext(app.container, req);
    await service.resolve(req.params.id);
    return { resolved: req.params.id };
  });

  app.get('/comment-threads', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.unresolvedThreadSummaries(workspaceId);
  });
}
