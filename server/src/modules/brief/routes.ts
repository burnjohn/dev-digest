import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrBrief } from '@devdigest/shared';
import type { WhyTimeline } from '@devdigest/shared/contracts/why';
import { getContext } from '../_shared/context.js';
import { ValidationError } from '../../platform/errors.js';
import { BriefService } from './service.js';
import { WhyService } from './why.js';

/**
 * A3 — PR Brief + git-why module (L04/L05, §12).
 *   GET /pulls/:id/brief        → PrBrief (Intent + Blast + Risks + History); persisted.
 *   GET /pulls/:id/why?file&line → WhyTimeline (git blame/log → commits/PRs).
 *
 * `?refresh=1` recomputes the brief; otherwise a persisted brief is returned
 * if present (cheap re-open of the PR detail).
 */
const WhyQuery = z.object({
  file: z.string().min(1),
  line: z.coerce.number().int().positive(),
});

export default async function briefRoutes(app: FastifyInstance) {
  const { container } = app;
  const brief = new BriefService(container);
  const why = new WhyService(container);

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    '/pulls/:id/brief',
    async (req): Promise<PrBrief> => {
      const { workspaceId } = await getContext(container, req);
      if (req.query.refresh !== '1') {
        const cached = await brief.getCached(workspaceId, req.params.id);
        if (cached) return cached;
      }
      return brief.forPull(workspaceId, req.params.id);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { file?: string; line?: string } }>(
    '/pulls/:id/why',
    async (req): Promise<WhyTimeline> => {
      const { workspaceId } = await getContext(container, req);
      const parsed = WhyQuery.safeParse(req.query);
      if (!parsed.success) {
        throw new ValidationError('`file` and `line` query params are required', parsed.error.format());
      }
      return why.forLine(workspaceId, req.params.id, parsed.data.file, parsed.data.line);
    },
  );
}
