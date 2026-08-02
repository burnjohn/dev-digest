import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RepoInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { RepoService } from './service.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — repos module. Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to RepoService.
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh  → re-fetch clone + bump last_polled_at
 *   DELETE /repos/:id          → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  // Register the clone job handler once.
  service.registerCloneJobHandler();

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/repos/:id/refresh', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId, req.params.id);
  });

  /**
   * Status of a background job. `POST /repos/:id/refresh` returns in ~10ms
   * because it only queues work — this is how a caller learns when the work
   * actually finished, and why it failed. Without it a 403 from a clone is
   * invisible: the POST already answered 200.
   */
  app.get('/jobs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const job = await service.jobStatus(workspaceId, req.params.id);
    if (!job) throw new NotFoundError('Job not found');
    return job;
  });

  app.delete('/repos/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });
}
