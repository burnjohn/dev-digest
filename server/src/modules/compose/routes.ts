import type { FastifyInstance } from 'fastify';
import { ComposeReviewInput } from '@devdigest/shared/contracts/eval-ci';
import { getContext } from '../_shared/context.js';
import { ComposeService } from './service.js';

/**
 * A4 — Compose Review (§12, owner A4).
 *   POST /pulls/:id/compose-review          → compose + POST to GitHub (PAT)
 *   POST /pulls/:id/compose-review/preview  → compose only (no side-effect)
 *   GET  /pulls/:id/compose-reviews         → list previously composed reviews
 */
export default async function composeRoutes(app: FastifyInstance) {
  const service = new ComposeService(app.container);

  app.post<{ Params: { id: string } }>('/pulls/:id/compose-review', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = ComposeReviewInput.parse(req.body ?? {});
    return service.post(workspaceId, req.params.id, input);
  });

  app.post<{ Params: { id: string } }>('/pulls/:id/compose-review/preview', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = ComposeReviewInput.parse(req.body ?? {});
    return service.preview(workspaceId, req.params.id, input);
  });

  app.get<{ Params: { id: string } }>('/pulls/:id/compose-reviews', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForPull(workspaceId, req.params.id);
  });
}
