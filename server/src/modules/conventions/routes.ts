import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { ConventionsService } from './service.js';

const RepoParams = z.object({ id: z.string().uuid() });
const CidParams = z.object({ id: z.string().uuid(), cid: z.string().uuid() });
const UpdateBody = z.object({ rule: z.string().optional(), category: z.string().optional() });
const PromoteBody = z.object({
  repo_url: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.extract(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.list(workspaceId, req.params.id);
    },
  );

  app.put(
    '/repos/:id/conventions/:cid',
    { schema: { params: CidParams, body: UpdateBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.update(workspaceId, req.params.cid, req.body);
    },
  );

  app.post(
    '/repos/:id/conventions/:cid/accept',
    { schema: { params: CidParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.accept(workspaceId, req.params.cid);
    },
  );

  app.post(
    '/repos/:id/conventions/:cid/reject',
    { schema: { params: CidParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.reject(workspaceId, req.params.cid);
    },
  );

  app.post(
    '/repos/:id/conventions/promote',
    { schema: { params: RepoParams, body: PromoteBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.conventions.promote(workspaceId, req.params.id, req.body.repo_url, req.body.name, req.body.description);
    },
  );
}
