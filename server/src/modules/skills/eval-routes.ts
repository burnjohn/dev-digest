import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  SkillEvalCaseCreateInput,
  SkillEvalRunAcceptedResponse,
  SkillEvalRunBatchRequest,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SkillEvalService } from './eval-service.js';

const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
const KpiDeltaQuery = z.object({ batch_id: z.string().uuid() });

/**
 * skill-eval routes — a sibling sub-plugin to `skills/routes.ts` (mirrors the
 * `reviews/smart-diff.routes.ts` precedent: `skills/routes.ts` is already
 * ~220 lines and this feature adds a comparable amount of new route surface,
 * so it lives in its own file rather than growing the existing one).
 *
 * Sibling to, and entirely independent of, the agent-eval routes in
 * `eval/routes.ts` — different scoring methodology, different route surface
 * (`/skills/:id/evals/*` vs `/agents/:id/evals/*`).
 *
 *   PATCH  /skills/:id/evals/:caseId          {SkillEvalCaseCreateInput} → edit-in-place (AC-39)
 *   POST   /findings/:id/evals/skill-case     {skill_id} → promote a finding into a skill-eval case (AC-4)
 *   POST   /skills/:id/evals/run              {SkillEvalRunBatchRequest} → 202 Accepted, fan-out detached (AC-11/12/14/18/19)
 *   GET    /skills/:id/evals/batches          → batch history (AC-32)
 *   GET    /skills/:id/evals/batches/:batchId → batch drill-down (AC-32) — client polls this for run completion
 *   GET    /skills/:id/evals/trend            → trend points, full batches only
 *   GET    /skills/:id/evals/compare?a=&b=    → side-by-side batch comparison
 *   GET    /skills/:id/evals/kpi-delta?batch_id= → KPI delta vs. previous full batch
 *   DELETE /skills/:id/evals/batches          → clear ALL run history (batches + runs) for this skill; cases survive
 *
 * The EXISTING `GET/POST/DELETE /skills/:id/evals` routes stay in
 * `skills/routes.ts` — this file adds run/history/detail/edit/from-finding
 * ONLY, no duplicate route paths.
 */
const CaseIdParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });
const BatchIdParams = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });
const CreateCaseFromFindingBody = z.object({ skill_id: z.string().uuid() });

export default async function skillEvalRoutes(appBase: FastifyInstance): Promise<void> {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SkillEvalService(container);

  // ---- Edit-in-place (full replacement; AC-39's threshold edit applies too) -
  app.patch(
    '/skills/:id/evals/:caseId',
    { schema: { params: CaseIdParams, body: SkillEvalCaseCreateInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.params.caseId, req.body);
    },
  );

  // ---- Promote an already-accepted/dismissed finding into a SKILL-eval case
  // (AC-4). Distinct path from the agent-eval `/findings/:id/evals/case`
  // route — the target skill is an explicit author choice carried in the
  // BODY, never inferred from the finding's owning agent.
  app.post(
    '/findings/:id/evals/skill-case',
    { schema: { params: IdParams, body: CreateCaseFromFindingBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.createCaseFromFinding(workspaceId, req.body.skill_id, req.params.id);
    },
  );

  // ---- Run a batch: full set (case_ids omitted) or a subset (calibration) --
  // 202 Accepted + detached fan-out, mirroring `eval/routes.ts`'s
  // `POST /agents/:id/evals/run` EXACTLY: resolve + insert the batch row
  // synchronously (fast, no LLM calls yet), take a child logger BEFORE
  // responding (Fastify recycles `req.log` once the response is sent), then
  // fan out detached.
  //
  // Rate-limited PER-WORKSPACE (not per-IP), matching the live agent-eval
  // route's stronger keying — skill-eval runs are paid-LLM fan-out too.
  app.post(
    '/skills/:id/evals/run',
    {
      schema: {
        params: IdParams,
        body: SkillEvalRunBatchRequest,
        response: { 202: SkillEvalRunAcceptedResponse },
      },
      config: {
        rateLimit: {
          max: 2,
          timeWindow: '1 minute',
          keyGenerator: async (req: FastifyRequest) => {
            const { workspaceId } = await getContext(container, req);
            return `skill-eval-run:${workspaceId}`;
          },
        },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const caseIds = req.body.case_ids ?? undefined;

      const started = await service.startEvalRun(
        workspaceId,
        req.params.id,
        req.body.host_agent_id,
        caseIds,
      );

      // Detach a child logger BEFORE responding — Fastify recycles req/req.log
      // once the response is sent (server/insights.md's "recycled req.log"
      // entry), so the fan-out below must use a logger taken now.
      const log = req.log.child({
        route: 'skill-evals.run',
        skillId: req.params.id,
        batchId: started.batch.id,
      });

      void service.executeEvalRun(started, log).catch((err: Error) => {
        log.error({ err }, 'skill-eval run: batch execution failed');
      });

      reply.code(202);
      return { batch_id: started.batch.id };
    },
  );

  // ---- Batch history (AC-32) ------------------------------------------------
  app.get('/skills/:id/evals/batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listBatchHistory(workspaceId, req.params.id);
  });

  // ---- Batch drill-down (AC-32) — client polls this for run completion -----
  app.get(
    '/skills/:id/evals/batches/:batchId',
    { schema: { params: BatchIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBatchDetail(workspaceId, req.params.batchId);
    },
  );

  // ---- Trend (full batches only) --------------------------------------------
  app.get('/skills/:id/evals/trend', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getTrend(workspaceId, req.params.id);
  });

  // ---- Side-by-side batch compare --------------------------------------------
  app.get(
    '/skills/:id/evals/compare',
    { schema: { params: IdParams, querystring: CompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compareBatches(workspaceId, req.query.a, req.query.b);
    },
  );

  // ---- KPI delta vs. previous FULL batch --------------------------------------
  app.get(
    '/skills/:id/evals/kpi-delta',
    { schema: { params: IdParams, querystring: KpiDeltaQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getKpiDelta(workspaceId, req.params.id, req.query.batch_id);
    },
  );

  // ---- Clear ALL run history for this skill (batches + runs); cases survive -
  app.delete('/skills/:id/evals/batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.clearHistory(workspaceId, req.params.id);
  });
}
