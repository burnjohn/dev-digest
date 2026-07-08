import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingTour } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';
import { ONBOARDING_RATE_LIMIT } from './constants.js';

/**
 * onboarding module.
 *   GET  /repos/:id/onboarding          — persisted tour (well-formed empty
 *                                          response when never generated).
 *   POST /repos/:id/onboarding/generate — fact-gather + rank + ONE LLM call,
 *                                          persist, return the refreshed tour
 *                                          synchronously. Rate-limited
 *                                          per-workspace (not per-IP).
 */
export default async function onboardingRoutes(appBase: FastifyInstance): Promise<void> {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new OnboardingService(container);

  app.get(
    '/repos/:id/onboarding',
    {
      schema: {
        params: IdParams,
        response: { 200: OnboardingTour },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getTour(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/onboarding/generate',
    {
      schema: {
        params: IdParams,
        response: { 200: OnboardingTour },
      },
      config: {
        rateLimit: {
          ...ONBOARDING_RATE_LIMIT,
          keyGenerator: async (req: import('fastify').FastifyRequest) => {
            const { workspaceId } = await getContext(container, req);
            return `onboarding-generate:${workspaceId}`;
          },
        },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const repoId = req.params.id;
      const log = req.log.child({ route: 'onboarding.generate', repoId });
      return service.generateTour(workspaceId, repoId, log);
    },
  );
}
