import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';

/**
 * Smart Diff route — deterministic file classifier, zero LLM calls.
 *
 * GET /pulls/:id/smart-diff
 *   Returns a SmartDiff object grouping PR files by role (core / wiring /
 *   boilerplate), overlaid with findings from the latest workspace-scoped
 *   review. Returns 404 only when the PR has no files at all.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.getSmartDiff(workspaceId, req.params.id);
    if (result === null) throw new NotFoundError('Pull request not found or has no files');
    return result;
  });
}
