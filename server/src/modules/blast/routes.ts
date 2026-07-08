import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BlastResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET /pulls/:id/blast — blast radius for a PR (index reads only, no LLM).
 */
export default async function blastRoutes(appBase: FastifyInstance): Promise<void> {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    {
      schema: {
        params: IdParams,
        response: { 200: BlastResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.getBlast(workspaceId, req.params.id);

      // Log one line with counts to prove "index reads only" in run logs.
      const symbolCount = result.blast?.changed_symbols.length ?? 0;
      const callerCount = result.blast?.downstream.reduce(
        (acc, d) => acc + d.callers.length,
        0,
      ) ?? 0;
      const endpointCount = result.blast?.downstream.reduce(
        (acc, d) => acc + d.endpoints_affected.length,
        0,
      ) ?? 0;
      req.log.info(
        { prId: req.params.id, symbols: symbolCount, callers: callerCount, endpoints: endpointCount },
        'blast: index reads complete',
      );

      // NOTE: the `truncated` map is omitted from the response body entirely
      // when no symbol was clamped — consumers cannot distinguish "not clamped"
      // from "field not supported"; this optionality is not called out in the
      // published response schema docs yet.
      return result;
    },
  );
}
