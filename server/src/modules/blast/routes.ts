import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { BlastService } from './service.js';

/**
 * `blast` module — "what else could this diff touch?"
 * (docs/plans/06-blast-radius.md).
 *
 *   GET /pulls/:id/blast → BlastRadiusResponse
 *
 * Shaped after `modules/lookup/` (the newest module, not the flat
 * `pulls/` pattern): `withTypeProvider<ZodTypeProvider>()`, the service
 * constructed inline from `app.container` against an explicit
 * `BlastServiceDeps`, `getContext` for tenancy, and a declared
 * `schema.response` so a Drizzle row can never reach the wire (REQ-1).
 *
 * D3/T9/A3 — the one-paragraph LLM narration's model is resolved HERE, not
 * in the service, following `conventions/routes.ts:55-67`'s precedent:
 * `resolveFeatureModel`'s first parameter is a `Container`, `routes.ts` is
 * one of the only rings permitted to name `Container`, and the service then
 * never has to know Settings exists. It is also what makes REQ-20
 * structural rather than a runtime `if`: with `BLAST_EXPLAIN_ENABLED` off,
 * this branch never runs, so `resolveFeatureModel` is never called (no
 * settings read) and the service is never handed a model, so
 * `deps.llm` is never called either.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BlastService({
    db: app.container.db,
    repoIntel: app.container.repoIntel,
    llm: (id) => app.container.llm(id),
  });

  app.get(
    '/pulls/:id/blast',
    {
      schema: {
        params: IdParams,
        response: { 200: BlastRadiusResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const narrationModel = app.container.config.blastExplainEnabled
        ? await resolveFeatureModel(app.container, workspaceId, 'review_intent')
        : undefined;
      const result = await service.getBlastRadius(workspaceId, req.params.id, narrationModel);
      if (!result) throw new NotFoundError('Pull request not found');
      return result;
    },
  );
}
