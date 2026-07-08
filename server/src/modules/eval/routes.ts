import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalAgentSummary,
  EvalCaseCreateInput,
  EvalRecentBatchRow,
  EvalRunAcceptedResponse,
  EvalRunAllResult,
  EvalRunBatchRequest,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';

/**
 * eval module (L06).
 *   GET    /agents/:id/evals/cases                → case list + skill-owned exclusion count (AC-2, AC-25)
 *   POST   /agents/:id/evals/cases                 {EvalCaseCreateInput} → hand-authored case (AC-7/AC-8)
 *   PATCH  /agents/:id/evals/cases/:caseId         {EvalCaseCreateInput} → edit-in-place (full replacement; AC-7/AC-8 apply)
 *   POST   /findings/:id/evals/case                → promote an accepted/dismissed finding into a case (AC-1)
 *   DELETE /agents/:id/evals/cases/:caseId         → delete a case (confirmation is client-side, AC-10)
 *   POST   /agents/:id/evals/run                   {EvalRunBatchRequest} → 202 Accepted, fan-out detached (AC-11/AC-14, #9)
 *   DELETE /agents/:id/evals/batches                → clear ALL run history (batches + runs) for this agent; cases survive
 *   GET    /agents/:id/evals/batches                → batch history (AC-33)
 *   GET    /agents/:id/evals/batches/:batchId       → batch drill-down (AC-33) — client polls this for run completion
 *   GET    /agents/:id/evals/trend                  → trend points, full batches only (AC-28–AC-30)
 *   GET    /agents/:id/evals/compare?a=&b=          → side-by-side batch comparison (AC-32)
 *   GET    /agents/:id/evals/kpi-delta?batch_id=     → KPI delta vs. previous full batch (AC-31, S5)
 *   GET    /evals/overview                          → cross-agent dashboard cards (AC-3–AC-6)
 *   GET    /evals/recent                            → cross-agent recent-batches feed, server-capped at 25 (AC-8/AC-9)
 *   POST   /evals/run-all                           → fan-out a batch for every eval-configured agent (AC-11–AC-13)
 */
const CaseIdParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });
const BatchIdParams = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
const KpiDeltaQuery = z.object({ batch_id: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance): Promise<void> {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ---- Case list (+ visible skill-owned exclusion count, AC-2) -------------
  app.get('/agents/:id/evals/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  // ---- Hand-authored case (AC-7/AC-8) ---------------------------------------
  app.post(
    '/agents/:id/evals/cases',
    { schema: { params: IdParams, body: EvalCaseCreateInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.createCaseManual(workspaceId, req.params.id, req.body);
    },
  );

  // ---- Edit-in-place (full replacement; AC-7/AC-8 apply to edits too) -------
  app.patch(
    '/agents/:id/evals/cases/:caseId',
    { schema: { params: CaseIdParams, body: EvalCaseCreateInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.params.caseId, req.body);
    },
  );

  // ---- Promote an already-accepted/dismissed finding into a case (AC-1) -----
  // Mirrors the existing /findings/:id/action path shape; the owning agent is
  // resolved server-side from the finding's review, so no body is required.
  app.post('/findings/:id/evals/case', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.createCaseFromFinding(workspaceId, req.params.id);
  });

  // ---- Delete a case (client already confirmed, AC-10) ----------------------
  app.delete(
    '/agents/:id/evals/cases/:caseId',
    { schema: { params: CaseIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.deleteCase(workspaceId, req.params.id, req.params.caseId);
      return { ok: true };
    },
  );

  // ---- Run a batch: full set (case_ids omitted) or a subset (calibration) --
  // 202 Accepted + detached fan-out (#9): the request only resolves the run
  // target and inserts the batch row, then returns immediately — the actual
  // multi-minute LLM fan-out runs detached, so a client/proxy timeout can
  // never orphan an in-flight batch mid-response. The client polls
  // `GET /agents/:id/evals/batches/:batchId` (status null = in progress),
  // mirroring `review-all`'s fire-and-forget precedent.
  //
  // Rate-limited PER-WORKSPACE (S3), not per-IP — upgraded from the
  // `review-all`-style default IP-keying to match the stronger pattern the
  // other two paid-LLM routes use (brief/onboarding): eval runs are paid-LLM
  // fan-out, so workspace A's runs must not share a bucket with workspace B
  // (or any IP-shared tenant).
  app.post(
    '/agents/:id/evals/run',
    {
      schema: { params: IdParams, body: EvalRunBatchRequest, response: { 202: EvalRunAcceptedResponse } },
      config: {
        rateLimit: {
          max: 2,
          timeWindow: '1 minute',
          keyGenerator: async (req: FastifyRequest) => {
            const { workspaceId } = await getContext(container, req);
            return `eval-run:${workspaceId}`;
          },
        },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const caseIds = req.body.case_ids ?? undefined;

      // Resolve + insert synchronously (fast — no LLM calls yet); #7's
      // dedup/400-on-empty-target-set validation lives inside startEvalRun.
      const started = await service.startEvalRun(workspaceId, req.params.id, caseIds);

      // Detach a child logger BEFORE responding — Fastify recycles req/req.log
      // once the response is sent (server/insights.md's "recycled req.log"
      // entry), so the fan-out below must use a logger taken now.
      const log = req.log.child({ route: 'evals.run', agentId: req.params.id, batchId: started.batch.id });

      void service.executeEvalRun(started, log).catch((err: Error) => {
        log.error({ err }, 'eval run: batch execution failed');
      });

      reply.code(202);
      return { batch_id: started.batch.id };
    },
  );

  // ---- Batch history (AC-33) ------------------------------------------------
  app.get('/agents/:id/evals/batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listBatchHistory(workspaceId, req.params.id);
  });

  // ---- Clear ALL run history for this agent (batches + runs); cases survive -
  app.delete('/agents/:id/evals/batches', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.clearHistory(workspaceId, req.params.id);
  });

  // ---- Batch drill-down (AC-33) ---------------------------------------------
  app.get(
    '/agents/:id/evals/batches/:batchId',
    { schema: { params: BatchIdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBatchDetail(workspaceId, req.params.batchId);
    },
  );

  // ---- Trend (full batches only, AC-28–AC-30) -------------------------------
  app.get('/agents/:id/evals/trend', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getTrend(workspaceId, req.params.id);
  });

  // ---- Side-by-side batch compare (AC-32) -----------------------------------
  app.get(
    '/agents/:id/evals/compare',
    { schema: { params: IdParams, querystring: CompareQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compareBatches(workspaceId, req.query.a, req.query.b);
    },
  );

  // ---- KPI delta vs. previous FULL batch (AC-31, S5) ------------------------
  // Wires the already-implemented `getKpiDelta`/`repo.previousFullBatch` to an
  // actual HTTP endpoint — previously unreachable (Sweep finding S5).
  app.get(
    '/agents/:id/evals/kpi-delta',
    { schema: { params: IdParams, querystring: KpiDeltaQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getKpiDelta(workspaceId, req.params.id, req.query.batch_id);
    },
  );

  // ---- Cross-agent dashboard: overview cards (AC-3–AC-6) --------------------
  app.get(
    '/evals/overview',
    { schema: { response: { 200: z.array(EvalAgentSummary) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getOverview(workspaceId);
    },
  );

  // ---- Cross-agent dashboard: recent-batches feed (AC-8/AC-9) ----------------
  // Server-side cap of 25 is applied inside `EvalService.getRecentAcrossAgents`
  // — no client-supplied `limit` query param, per the spec's resolved
  // NEEDS-CLARIFICATION (this plan's §8 Out of Scope).
  app.get(
    '/evals/recent',
    { schema: { response: { 200: z.array(EvalRecentBatchRow) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRecentAcrossAgents(workspaceId);
    },
  );

  // ---- Cross-agent dashboard: run every eval-configured agent (AC-11–AC-13) -
  // Same 202-Accepted + detached-fan-out shape as `POST /agents/:id/evals/run`
  // above: `startRunAll` resolves + inserts every agent's batch row
  // synchronously (fast, no LLM calls yet), then returns immediately.
  // `executeRunAll` runs detached via `void ... .catch(...)` with a
  // `req.log.child({...})` captured BEFORE responding — Fastify recycles
  // `req.log` once the response is sent (server/insights.md's "recycled
  // req.log" entry), so the fan-out below must use a logger taken now.
  //
  // Rate-limited PER-WORKSPACE (AC-12), matching this file's existing
  // `eval-run:${workspaceId}` keying convention for `/agents/:id/evals/run` —
  // not `review-all`'s default IP-keying.
  app.post(
    '/evals/run-all',
    {
      schema: { response: { 202: EvalRunAllResult } },
      config: {
        rateLimit: {
          max: 2,
          timeWindow: '1 minute',
          keyGenerator: async (req: FastifyRequest) => {
            const { workspaceId } = await getContext(container, req);
            return `eval-run-all:${workspaceId}`;
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = await getContext(container, req);
      const log = req.log.child({ route: 'evals/run-all', workspaceId: ctx.workspaceId });
      const { result, started } = await service.startRunAll(ctx.workspaceId, log);

      void service.executeRunAll(started, log).catch((err: Error) => {
        log.error({ err }, 'eval run-all: batch execution failed');
      });

      reply.code(202);
      return result;
    },
  );
}
