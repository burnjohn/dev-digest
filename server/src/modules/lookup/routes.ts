import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PullLookupResult } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { LookupService } from './service.js';

/**
 * `lookup` module — the human-coordinates→internal-id boundary
 * (docs/plans/05-mcp-server.md §5.2). Every other route is keyed by an
 * internal uuid; an MCP client only knows a repo's `owner/name` and a PR
 * `number`. This module answers exactly one question, read-only: no GitHub
 * call, no write. That is the entire reason it exists instead of reusing
 * `GET /repos/:id/pulls`, which syncs from GitHub before it answers (§5.2,
 * option A) — and it is genuinely cross-aggregate (it joins `repos` and
 * `pull_requests`), so it belongs to neither existing module.
 *
 *   GET /lookup/pull?repo=<owner/name>&number=<n> → PullLookupResult
 *
 * There is exactly one route. An earlier draft paired it with
 * `GET /lookup/run`; D-H retired it because `GET /pulls/:id/runs/active`
 * already answers the only question the MCP layer asks about runs in flight.
 * Do not add it back, and do not add an `agent_runs` query to this module.
 */

const LookupPullQuerystring = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

export default async function lookupRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new LookupService({ db: app.container.db });

  app.get(
    '/lookup/pull',
    {
      schema: {
        querystring: LookupPullQuerystring,
        response: { 200: PullLookupResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.resolvePull(workspaceId, req.query.repo, req.query.number);
    },
  );
}
