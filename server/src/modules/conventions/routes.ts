import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { ConventionsService } from './service.js';

/**
 * A1 — conventions module (§12, owner A1).
 *   GET  /repos/:id/conventions          → list extracted candidates
 *   POST /repos/:id/conventions/extract  → scan repo + LLM → ConventionCandidate[]
 *   POST /conventions/:id/accept         → accept candidate → create a Skill
 */

const ExtractBody = z
  .object({
    provider: z.enum(['openai', 'anthropic']).optional(),
    model: z.string().optional(),
  })
  .optional();

export default async function conventionsRoutes(app: FastifyInstance) {
  const service = new ConventionsService(app.container);

  app.get<{ Params: { id: string } }>('/repos/:id/conventions', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/repos/:id/conventions/extract', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = ExtractBody.parse(req.body ?? {}) ?? {};
    return service.extract(workspaceId, req.params.id, {
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.model ? { model: body.model } : {}),
    });
  });

  app.post<{ Params: { id: string } }>('/conventions/:id/accept', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { skillId } = await service.accept(workspaceId, req.params.id);
    return { accepted: true, skill_id: skillId };
  });
}
