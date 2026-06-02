import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CiExportInput } from '@devdigest/shared/contracts/eval-ci';
import { getContext } from '../_shared/context.js';
import { CiService } from './service.js';
import type { CiActionsClient } from './actions-client.js';

/**
 * A4 — Export-to-CI + CI Runs (§12, owner A4).
 *   POST /agents/:id/export-ci   → generate workflow artifacts (+ open PR), persist install
 *   GET  /ci-runs                → ingest from Actions API + list ci_runs
 *   GET  /ci-installations       → list installations for the workspace
 *   POST /ci-runs/ingest         → force an ingestion pass (returns count)
 *
 * Tests inject a mock Actions client by decorating the Fastify app with
 * `ciActionsClient` before registering modules; in production the service
 * resolves the real Octokit Actions client from the PAT.
 */
export default async function ciRoutes(app: FastifyInstance) {
  // Late-bound: read the (test) override at request time so a mock decorated on
  // the app instance after module registration is still honoured; production
  // falls back to the real Octokit Actions client inside CiService.
  const factory = async () => (app as { ciActionsClient?: CiActionsClient }).ciActionsClient;
  const service = new CiService(app.container, factory);

  app.post<{ Params: { id: string } }>('/agents/:id/export-ci', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = CiExportInput.parse(req.body ?? {});
    reply.code(201);
    return service.export(workspaceId, req.params.id, input);
  });

  const RunsQuery = z.object({ ingest: z.enum(['true', 'false']).optional() });

  app.get('/ci-runs', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = RunsQuery.parse(req.query ?? {});
    return service.listRuns(workspaceId, { ingest: q.ingest !== 'false' });
  });

  app.get('/ci-installations', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listInstallations(workspaceId);
  });

  app.post('/ci-runs/ingest', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const count = await service.ingest(workspaceId);
    return { ingested: count };
  });
}
