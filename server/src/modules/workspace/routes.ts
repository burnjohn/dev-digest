import type { FastifyInstance } from 'fastify';
import { getContext } from '../_shared/context.js';
import { toWorkspaceRepoSummary } from './helpers.js';

/**
 * F1 — workspace manager: where clones live + a summary of cloned repos.
 *   GET /workspace → workspace info + cloneDir + cloned repos summary
 *
 * Stays routes-only on purpose: there is no business rule here, just a scoped
 * read and a DTO map. The `repos` table belongs to the repos module, so it is
 * read through `container.reposRepo` rather than queried from the transport.
 *
 * Cleanup/re-pull of individual repos is handled by the repos module
 * (refresh/delete); this surface gives the UI an overview.
 */
export default async function workspaceRoutes(app: FastifyInstance) {
  const { container } = app;

  app.get('/workspace', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repos = await container.reposRepo.listWithToken(workspaceId);
    return {
      workspaceId,
      cloneDir: container.config.cloneDir,
      repos: repos.map(toWorkspaceRepoSummary),
    };
  });
}
