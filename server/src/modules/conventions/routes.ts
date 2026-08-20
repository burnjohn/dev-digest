import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions Extractor — scan a repo for its house rules, triage them, turn
 * the accepted ones into a skill.
 *
 *   GET    /repos/:id/conventions          → this repo's candidates
 *   POST   /repos/:id/conventions/extract  → scan (sample → model → evidence gate)
 *   POST   /repos/:id/conventions/skill    → skill DRAFT from accepted (no write)
 *   PATCH  /conventions/:id                → accept / reject / edit the rule
 *   DELETE /conventions/:id                → drop a candidate
 *
 * The scan route is a POST because it costs a model call; everything else is
 * ordinary CRUD over the candidates the scan produced.
 */

const ExtractParams = z.object({ id: z.string().uuid() });

const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  rationale: z.string().nullable().optional(),
  status: ConventionStatus.optional(),
});

/** Optional explicit selection; omitted means "every accepted candidate". */
const SkillDraftBody = z
  .object({ convention_ids: z.array(z.string().uuid()).optional() })
  .default({});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: ExtractParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: ExtractParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: ExtractParams, body: SkillDraftBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id, req.body.convention_ids);
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.delete('/conventions/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Convention not found');
    return { ok: true };
  });
}
