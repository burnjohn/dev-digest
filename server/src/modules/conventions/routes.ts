import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionSkillInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

const RepoParams = z.object({ id: z.string().uuid() });
const ConventionParams = z.object({ id: z.string().uuid() });

const PatchBody = z.object({
  action: z.enum(['accept', 'reject', 'edit', 'undo']),
  rule: z.string().min(1).optional(),
});

/**
 * Conventions Extractor module.
 *   GET  /repos/:id/conventions/scans   → list past scans (newest first)
 *   POST /repos/:id/conventions/extract → fire-and-forget extraction; returns scan record
 *   GET  /repos/:id/conventions         → list candidates for a repo
 *   PATCH /conventions/:id              → accept | reject | edit a candidate
 *   POST /repos/:id/conventions/skills  → create skill(s) from accepted conventions
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions/scans', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listScans(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: RepoParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const log = req.log.child({ route: 'conventions/extract', repoId: req.params.id });
      const scan = await service.extract(workspaceId, req.params.id, log);
      reply.status(202);
      return scan;
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: ConventionParams, body: PatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.patch(workspaceId, req.params.id, req.body.action, req.body.rule);
    },
  );

  app.post(
    '/repos/:id/conventions/skills',
    { schema: { params: RepoParams, body: ConventionSkillInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skills = await service.createSkills(workspaceId, req.params.id, req.body);
      reply.status(201);
      return skills;
    },
  );
}
