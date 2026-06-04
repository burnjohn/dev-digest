import type { FastifyInstance } from 'fastify';
import { RepoInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { RepoService } from './service.js';

/**
 * F1 — repos module (§12). Transport layer only: parses requests, maps status
 * codes, and delegates all business logic to RepoService.
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh  → re-fetch clone + bump last_polled_at
 *   DELETE /repos/:id          → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */
export default async function reposRoutes(app: FastifyInstance) {
  const service = new RepoService(app.container);

  // Register the clone job handler once.
  service.registerCloneJobHandler();

  app.post('/repos', async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { url } = RepoInput.parse(req.body);
    const { repo, created } = await service.add(workspaceId, userId, url);
    reply.status(created ? 201 : 200);
    return repo;
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post<{ Params: { id: string } }>('/repos/:id/refresh', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.refresh(workspaceId, req.params.id);
  });

  app.delete<{ Params: { id: string } }>('/repos/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.remove(workspaceId, req.params.id);
    return { deleted: req.params.id };
  });
}
