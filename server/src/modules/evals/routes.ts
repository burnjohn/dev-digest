import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Provider } from '@devdigest/shared';
import {
  EvalBatchComparison,
  EvalBatchDetail,
  EvalBatchRecord,
  EvalCaseRecord,
  EvalCaseRunResult,
  EvalCaseWrite,
  EvalOwnerDashboard,
  EvalOwnerKind,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { EvalsService, type AgentRunnerInfo } from './service.js';
// FIX-3: `routes.ts` is R5 (transport), and R5's MUST-NOT column forbids
// importing `adapters/**` directly (onion-architecture §2) — even though
// this module IS the composition root for `modules/evals/**`, that role
// belongs to R6 (`platform/container.ts`), not to a route file. `container.ts`
// is the actual construction site now; this file reads `app.container.
// parseUnifiedDiff` off it, the same shape already used for `app.container.
// llm`/`app.container.agentsRepo`, and threads it into `EvalsService` as
// `EvalsServiceDeps.parseUnifiedDiff`, which threads it down to
// `pipeline/case-runner.ts` (R2) via `CaseRunnerDeps`. Neither `service.ts`
// nor `pipeline/**` import `adapters/**` directly.

/**
 * T13 — evals module (SPEC-03, docs/plans/09-eval-pipeline.md §4.2):
 *   GET    /evals/cases                 → an owner's cases + each one's latest run
 *   POST   /evals/cases                 → create; derives expectation_kind
 *   PUT    /evals/cases/:id             → update, same derivations
 *   DELETE /evals/cases/:id             → delete case + its runs
 *   POST   /evals/cases/:id/run         → single-case run, with arm only
 *   POST   /evals/batches               → start a set-run; 202 { batch_id }
 *   GET    /evals/batches/:id           → batch detail, partial while running
 *   GET    /evals/batches               → batch history
 *   GET    /evals/batches/compare       → two-batch comparison + version diff
 *   GET    /evals/dashboard             → one row per enabled agent
 *   GET    /evals/dashboard/:agentId    → drill-in
 *
 * `GET /findings/:id/eval-draft` is the REVIEWS module's (T11) — not served
 * here, per §4.3's cross-module placement decision.
 *
 * Every route declares `schema.response`, following `modules/skills/routes.ts`.
 * A handler does four things only: read validated input, resolve tenancy via
 * `getContext`, call ONE service method, map a status code — everything else
 * (the 400/422/413 split, staleness, ownership caps) lives in `service.ts`.
 */

const OwnerQuery = z.object({ owner_kind: EvalOwnerKind, owner_id: z.string().uuid() });
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });
const AgentIdParams = z.object({ agentId: z.string().uuid() });

/** `EvalCaseRecord` widened with the case's latest run (`GET /evals/cases`,
 * REQ-7/8/9) — composed locally, matching the client's own
 * `lib/hooks/evals.ts::EvalCaseListItem` doc comment: not a contract type of
 * its own. */
const EvalCaseListItem = EvalCaseRecord.extend({ latest_run: EvalCaseRunResult.nullable() });

/**
 * REQ-10's "plus `file` for an agent case" is a cross-field rule the base
 * `EvalCaseWrite` schema cannot express on its own (whether `file` is
 * required depends on the SIBLING `owner_kind` field) — a `superRefine` on
 * top of the imported contract, not a hand-rolled `.parse()` in the handler.
 * A skill-owned write is left alone here — `file` on its expectations is
 * optional at the schema level (AC-55) and `service.ts::prepareCaseWrite`
 * overwrites it unconditionally with the case's synthesized filename either
 * way, so there is nothing this refinement needs to enforce on that branch.
 */
const EvalCaseBody = EvalCaseWrite.superRefine((body, ctx) => {
  if (body.owner_kind !== 'agent') return;
  body.expected_output.forEach((expectation, index) => {
    if (!expectation.file) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'file is required for an agent-owned expectation',
        path: ['expected_output', index, 'file'],
      });
    }
  });
});

const StartBatchBody = z.object({ owner_kind: EvalOwnerKind, owner_id: z.string().uuid() });
const StartBatchResponse = z.object({ batch_id: z.string() });
const OkResponse = z.object({ ok: z.boolean() });

/** Narrows an `AgentsRepository` row (fetched through `app.container.agentsRepo`
 * — the composition-root-sanctioned cross-module read, same shape as
 * `container.repoIntel`/`container.blast`) to the eval pipeline's own
 * `AgentRunnerInfo`. Declared here, not imported from `modules/agents/**` —
 * `service.ts` never sees an `AgentRow`. */
function toAgentRunnerInfo(row: {
  id: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  version: number;
}): AgentRunnerInfo {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    version: row.version,
  };
}

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Built once in the plugin body (fastify-best-practices), not per handler.
  // `EvalsServiceDeps` is explicit, not `Container` — `resolveAgent` and
  // `listEnabledAgents` are lazy closures over `app.container.agentsRepo`,
  // never a resolved value, so `service.ts` stays free of any agents-module import.
  const service = new EvalsService({
    db: app.container.db,
    llm: (id) => app.container.llm(id),
    resolveAgent: async (workspaceId, agentId) => {
      const row = await app.container.agentsRepo.getById(workspaceId, agentId);
      return row ? toAgentRunnerInfo(row) : undefined;
    },
    listEnabledAgents: async (workspaceId) => {
      const rows = await app.container.agentsRepo.listEnabled(workspaceId);
      return rows.map(toAgentRunnerInfo);
    },
    parseUnifiedDiff: app.container.parseUnifiedDiff,
    // AC-73: `resolveFeatureModel` takes a `Container` — R2 (`service.ts`)
    // may never import `platform/container` (onion-architecture §2), so this
    // is the one construction site, same shape as `resolveAgent`/
    // `listEnabledAgents` above.
    resolveEvalBaselineModel: (workspaceId) =>
      resolveFeatureModel(app.container, workspaceId, 'eval_baseline'),
  });

  // ===========================================================================
  // Cases — REQ-7, REQ-8, REQ-9, REQ-10, REQ-11, REQ-12, REQ-40, REQ-43, REQ-50, REQ-70
  // ===========================================================================

  app.get(
    '/evals/cases',
    { schema: { querystring: OwnerQuery, response: { 200: z.array(EvalCaseListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.query.owner_kind, req.query.owner_id);
    },
  );

  app.post(
    '/evals/cases',
    { schema: { body: EvalCaseBody, response: { 201: EvalCaseRecord } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/evals/cases/:id',
    { schema: { params: IdParams, body: EvalCaseBody, response: { 200: EvalCaseRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return updated;
    },
  );

  app.delete(
    '/evals/cases/:id',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.deleteCase(workspaceId, req.params.id);
      if (result.status === 'not_found') throw new NotFoundError('Eval case not found');
      if (result.status === 'conflict') {
        throw new ConflictError('This case is referenced by a running batch', {
          batch_id: result.batchId,
        });
      }
      return { ok: true };
    },
  );

  app.post(
    '/evals/cases/:id/run',
    { schema: { params: IdParams, response: { 200: EvalCaseRunResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.runCase(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Eval case not found');
      return result;
    },
  );

  // ===========================================================================
  // Batches — REQ-13, REQ-14, REQ-15, REQ-17, REQ-18, REQ-19, REQ-31, REQ-34-36, REQ-40, REQ-71
  // ===========================================================================

  app.post(
    '/evals/batches',
    { schema: { body: StartBatchBody, response: { 202: StartBatchResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { batchId } = await service.startBatch(
        workspaceId,
        req.body.owner_kind,
        req.body.owner_id,
      );
      reply.status(202);
      return { batch_id: batchId };
    },
  );

  // Registered before `/evals/batches/:id` for readability — find-my-way
  // already matches the static `compare` segment ahead of the parametric
  // route regardless of registration order.
  app.get(
    '/evals/batches/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalBatchComparison } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compareBatches(workspaceId, req.query.a, req.query.b);
    },
  );

  app.get(
    '/evals/batches/:id',
    { schema: { params: IdParams, response: { 200: EvalBatchDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const detail = await service.getBatch(workspaceId, req.params.id);
      if (!detail) throw new NotFoundError('Eval batch not found');
      return detail;
    },
  );

  app.get(
    '/evals/batches',
    { schema: { querystring: OwnerQuery, response: { 200: z.array(EvalBatchRecord) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listBatches(workspaceId, req.query.owner_kind, req.query.owner_id);
    },
  );

  // ===========================================================================
  // Dashboard — REQ-29, REQ-30, REQ-32, REQ-33, REQ-37, REQ-71
  // ===========================================================================

  app.get(
    '/evals/dashboard',
    { schema: { response: { 200: z.array(EvalOwnerDashboard) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDashboard(workspaceId);
    },
  );

  app.get(
    '/evals/dashboard/:agentId',
    { schema: { params: AgentIdParams, response: { 200: EvalOwnerDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const dashboard = await service.getOwnerDashboard(workspaceId, req.params.agentId);
      if (!dashboard) throw new NotFoundError('Agent not found');
      return dashboard;
    },
  );
}
