import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrDetail, PrMeta, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/** `:id` = repo uuid, `:number` = the PR's GitHub number (positive int). */
const RepoPullNumberParams = z.object({
  id: z.string().uuid(),
  number: z.coerce.number().int().positive(),
});

/**
 * F1 — pulls module. Transport layer only: parses requests, resolves tenancy,
 * and delegates to PullsService.
 *   GET  /repos/:id/pulls    → list PRs for a repo (open + recently merged/closed,
 *                              synced from GitHub, persisted)
 *   GET  /pulls/:id          → full PR detail (diff/files, commits, body)
 *   GET  /pulls/:id/comments → inline review comments (proxied to GitHub)
 *   POST /pulls/:id/comments → create one inline review comment
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL and
 * owned by the reviews module — this one only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService(app.container);

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id, req.log);
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(app.container, req);
    return service.detail(workspaceId, req.params.id, req.log);
  });

  // Direct lookup by (repo, GitHub number) — the PR page's cold-load path, so
  // it never has to resolve the uuid through the whole pulls list first.
  app.get(
    '/repos/:id/pulls/number/:number',
    { schema: { params: RepoPullNumberParams } },
    async (req): Promise<PrDetail> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.detailByNumber(workspaceId, req.params.id, req.params.number, req.log);
    },
  );

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listComments(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(app.container, req);
      return service.createComment(workspaceId, req.params.id, req.body);
    },
  );
}
