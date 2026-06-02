import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EvalCase } from '@devdigest/shared';
import { EvalCaseInput } from '@devdigest/shared/contracts/eval-ci';
import { getContext } from '../_shared/context.js';
import { EvalService } from './service.js';
import type { EvalCaseRow } from './repository.js';

/**
 * A4 — eval module (§12, owner A4).
 *   GET    /eval-cases                 → list (optional ?owner_kind & ?owner_id)
 *   POST   /eval-cases                 → create a case
 *   GET    /eval-cases/:id             → one case
 *   PUT    /eval-cases/:id             → update a case
 *   DELETE /eval-cases/:id             → delete a case
 *   POST   /eval-cases/:id/run         → run the case → EvalRun metrics
 *   POST   /agents/:id/eval/run-all    → run every case owned by the agent
 *   GET    /eval/dashboard             → aggregates + trends (optional owner filter)
 */

function caseToDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalCase['owner_kind'],
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
  };
}

const ListQuery = z.object({
  owner_kind: z.enum(['agent', 'skill']).optional(),
  owner_id: z.string().optional(),
});

export default async function evalRoutes(app: FastifyInstance) {
  const service = new EvalService(app.container);

  app.get('/eval-cases', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = ListQuery.parse(req.query ?? {});
    const filter = {
      ...(q.owner_kind ? { ownerKind: q.owner_kind } : {}),
      ...(q.owner_id ? { ownerId: q.owner_id } : {}),
    };
    const cases = await service.listCases(workspaceId, filter);
    return cases.map((c) => ({ ...caseToDto(c), last_run: c.last_run ?? null }));
  });

  app.post('/eval-cases', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = EvalCaseInput.parse(req.body);
    const row = await service.createCase(workspaceId, input);
    reply.code(201);
    return caseToDto(row);
  });

  app.get<{ Params: { id: string } }>('/eval-cases/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return caseToDto(await service.getCase(workspaceId, req.params.id));
  });

  app.put<{ Params: { id: string } }>('/eval-cases/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const input = EvalCaseInput.partial().parse(req.body);
    return caseToDto(await service.updateCase(workspaceId, req.params.id, input));
  });

  app.delete<{ Params: { id: string } }>('/eval-cases/:id', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    reply.code(204);
  });

  app.post<{ Params: { id: string } }>('/eval-cases/:id/run', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runCase(workspaceId, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/agents/:id/eval/run-all', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.runAllForAgent(workspaceId, req.params.id);
  });

  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const q = ListQuery.parse(req.query ?? {});
    const filter = {
      ...(q.owner_kind ? { ownerKind: q.owner_kind } : {}),
      ...(q.owner_id ? { ownerId: q.owner_id } : {}),
    };
    return service.dashboard(workspaceId, filter);
  });
}
