import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — polling module. MANUAL refresh that ONLY syncs the PR list
 * (new/updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual (user presses Run Review, owned by the reviews module).
 *
 *   POST /repos/:id/poll → sync PR list from GitHub, bump last_polled_at
 *
 * Stays routes-only on purpose: the handler is a scoped read plus two writes
 * that other modules already own. `repos` goes through `container.reposRepo`
 * and the PR import through `container.pullsRepo`, so the upsert rules live in
 * ONE place and cannot drift from the pulls module's copy.
 *
 * Unlike `GET /repos/:id/pulls`, this endpoint does NOT degrade offline: the
 * user explicitly asked to sync, so a missing token surfaces as an error.
 */
export default async function pollingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const repo = await container.reposRepo.getById(workspaceId, req.params.id);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await container.github(repo.githubTokenId);
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    for (const pr of pulls) {
      await container.pullsRepo.upsertFromGitHub(workspaceId, repo.id, pr);
    }
    await container.reposRepo.touchPolledAt(repo.id);

    // NOTE: no review is triggered here — manual trigger only.
    return { synced: pulls.length, reviewTriggered: false };
  });
}
