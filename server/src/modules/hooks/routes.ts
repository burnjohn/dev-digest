import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { HooksService } from './service.js';

/**
 * A4 — Hooks (Secret-Leakage + Phantom-API detectors) (§7 L06).
 *   POST /pulls/:id/hooks/scan   → run detectors, persist grounding-exempt findings
 *
 * Additive to A2's review flow: the findings are stored as their own review row
 * and surface in the PR's Findings tab next to the LLM reviewer's output.
 */
const Body = z
  .object({
    secret: z.boolean().optional(),
    phantom: z.boolean().optional(),
  })
  .optional();

export default async function hooksRoutes(app: FastifyInstance) {
  const service = new HooksService(app.container);

  app.post<{ Params: { id: string } }>('/pulls/:id/hooks/scan', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = Body.parse(req.body ?? {}) ?? {};
    return service.scan(workspaceId, req.params.id, {
      ...(body.secret !== undefined ? { secret: body.secret } : {}),
      ...(body.phantom !== undefined ? { phantom: body.phantom } : {}),
    });
  });
}
