import type { FastifyInstance } from 'fastify';
import type { Onboarding } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { OnboardingService } from './service.js';

/**
 * A3 — Onboarding module (L05, §12).
 *   POST /repos/:id/onboarding/generate → RAG → 5-section Onboarding (persisted)
 *   GET  /repos/:id/onboarding          → the persisted Onboarding (404 if none)
 */
export default async function onboardingRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new OnboardingService(container);

  app.post<{ Params: { id: string } }>(
    '/repos/:id/onboarding/generate',
    async (req): Promise<Onboarding> => {
      const { workspaceId } = await getContext(container, req);
      return service.generate(workspaceId, req.params.id);
    },
  );

  app.get<{ Params: { id: string } }>('/repos/:id/onboarding', async (req): Promise<Onboarding> => {
    await getContext(container, req);
    const onboarding = await service.get(req.params.id);
    if (!onboarding) {
      throw new NotFoundError('No onboarding tour generated yet — run generate first.');
    }
    return onboarding;
  });
}
