import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalSkillCaseFromFindingInput, EvalSkillRunInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { RUN_RATE_LIMIT } from './constants.js';

/**
 * specs/12-eval-pipeline.md — the composition point: `getContext` first on
 * every route, zod `params`/`body`/`querystring`, per-route rate limits on
 * the two run-start routes (AC-27). specs/15-skill-eval-cases.md's skill
 * routes (§7) follow the identical shape, one section down.
 */

const EvalCaseEditBody = EvalCaseInput.partial();

const RunAllBody = z.object({ confirm: z.literal(true) });

const CompareQuery = z
  .object({ a: z.string().uuid(), b: z.string().uuid() })
  .refine((q) => q.a !== q.b, { message: 'Select two distinct runs to compare.' });

const SkillEstimateQuery = z.object({ carrier_agent_id: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = container.evalService;

  // ---- Case creation from a triaged finding (AC-1 … AC-7) -----------------
  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const { case: evalCase, created } = await service.createCaseFromFinding(
      workspaceId,
      req.params.id,
    );
    reply.status(created ? 201 : 200);
    return evalCase;
  });

  // ---- Case reads / hand-authored creation / edit / delete -----------------
  app.get('/agents/:id/eval/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, 'agent', req.params.id);
  });

  // The agent-owned mirror of '/skills/:id/eval/cases' below (AC-8's
  // hand-authored path, same EvalCaseInput body/422s via createAgentCase).
  app.post(
    '/agents/:id/eval/cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.createAgentCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  app.get('/eval/cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.getCase(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.patch(
    '/eval/cases/:id',
    { schema: { params: IdParams, body: EvalCaseEditBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete('/eval/cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    reply.status(204);
  });

  // ---- Run lifecycle (AC-8, AC-15, AC-24 … AC-28, AC-49) -------------------
  app.get('/agents/:id/eval/estimate', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.estimate(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval/runs',
    { schema: { params: IdParams }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.startRun(workspaceId, req.params.id);
      reply.status(202);
      return result;
    },
  );

  app.get('/agents/:id/eval/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get('/eval/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const run = await service.getRun(workspaceId, req.params.id);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  });

  app.post(
    '/eval/runs/all',
    { schema: { body: RunAllBody }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAll(workspaceId);
    },
  );

  // ---- Compare (AC-32 … AC-34) ---------------------------------------------
  app.get('/eval/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.compare(workspaceId, req.query.a, req.query.b);
  });

  // ---- Dashboard + agent detail (AC-40 … AC-48) ----------------------------
  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId);
  });

  app.get('/eval/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.agentDetail(workspaceId, req.params.id);
  });

  // =========================================================================
  // specs/15-skill-eval-cases.md §7 — skill-owned eval routes
  // =========================================================================

  // ---- Case creation from a triaged finding (AC-1, AC-2) -------------------
  app.get('/findings/:id/eval-skills', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listSkillOffersForFinding(workspaceId, req.params.id);
  });

  app.post(
    '/findings/:id/skill-eval-case',
    { schema: { params: IdParams, body: EvalSkillCaseFromFindingInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const { case: evalCase, created } = await service.createCaseFromFindingForSkill(
        workspaceId,
        req.params.id,
        req.body.skill_id,
      );
      reply.status(created ? 201 : 200);
      return evalCase;
    },
  );

  // ---- Case reads / hand-authored creation (AC-8, AC-34) --------------------
  app.get('/skills/:id/eval/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, 'skill', req.params.id);
  });

  app.post(
    '/skills/:id/eval/cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.createSkillCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  // ---- Run lifecycle (AC-11, AC-12, AC-15, AC-25 … AC-28, AC-49) -----------
  app.get('/skills/:id/eval/carriers', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listSkillCarriers(workspaceId, req.params.id);
  });

  app.get(
    '/skills/:id/eval/estimate',
    { schema: { params: IdParams, querystring: SkillEstimateQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.skillEstimate(workspaceId, req.params.id, req.query.carrier_agent_id);
    },
  );

  app.post(
    '/skills/:id/eval/runs',
    {
      schema: { params: IdParams, body: EvalSkillRunInput },
      config: { rateLimit: RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.startSkillRun(
        workspaceId,
        req.params.id,
        req.body.carrier_agent_id,
      );
      reply.status(202);
      return result;
    },
  );

  app.get('/skills/:id/eval/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listSkillRuns(workspaceId, req.params.id);
  });

  app.post(
    '/eval/skills/runs/all',
    { schema: { body: RunAllBody }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllSkills(workspaceId);
    },
  );

  // ---- Compare (AC-32, AC-33) ------------------------------------------------
  app.get('/eval/skills/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.skillCompare(workspaceId, req.query.a, req.query.b);
  });
}
