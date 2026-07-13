/**
 * eval-routes.ts — Fastify route plugin for eval-case CRUD + run orchestrator
 *   + dashboard / compare / promote (T5 case CRUD, T6 run orchestrator, T7 reads,
 *   Ring 4).
 *
 * Schema-first via `fastify-type-provider-zod` (no hand-rolled `Schema.parse`).
 * Mirrors the structure of `agents/routes.ts` — `withTypeProvider`, `getContext`,
 * schema objects in the `{ schema: { ... } }` option.
 *
 * Routes owned by T5 (case CRUD):
 *   POST   /agents/:id/eval-cases          → createCase (manual) + createCaseFromFinding
 *   GET    /agents/:id/eval-cases          → listCases
 *   DELETE /agents/:id/eval-cases/:caseId  → deleteCase
 *
 * Routes owned by T6 (run orchestrator):
 *   POST   /agents/:id/eval-runs           → runAgentEvals (returns EvalRunGroupResult)
 *   POST   /eval-runs/all                  → runAllAgents (returns EvalRunGroupResult[])
 *
 * Routes owned by T7 (history / compare / promote / dashboard):
 *   GET    /agents/:id/eval-runs           → runHistory (EvalDashboard)
 *   POST   /agents/:id/eval-compare        → compare (EvalCompareResult)
 *   POST   /agents/:id/promote/:version    → promote (AgentVersion)
 *   GET    /evals/dashboard                → dashboard (EvalDashboard[])
 *
 * IMPORTANT: this plugin is registered in `modules/agents/routes.ts` (T7's
 * single-owner edit). The plugin is exported as `default` so registration is
 * `app.register(evalRoutes)`.
 *
 * Service construction hoisted to plugin-init (INSIGHTS 2026-07-12) to match
 * the `agents/routes.ts` convention (one instance per plugin, not per-request).
 */

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseInput,
  EvalCaseOneClickInput,
  EvalRunGroupResult,
  EvalRunGroup,
  EvalDashboard,
  EvalCompareResult,
  AgentVersion,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './eval-service.js';

// ---------------------------------------------------------------------------
// T7 route-local schemas
// ---------------------------------------------------------------------------

/** `:id` = agent uuid; `:version` = positive integer (for promote). */
const PromoteParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/** Body for POST /agents/:id/eval-compare (two run group ids). */
const EvalCompareBody = z.object({
  run_group_id_a: z.string().uuid(),
  run_group_id_b: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Route-local param schemas
// ---------------------------------------------------------------------------

/** `:id` = agent uuid; `:caseId` = eval case uuid. */
const EvalCaseParams = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST /agents/:id/eval-cases body schema
//
// Two creation paths share this endpoint:
//   1. Manual "New eval case" modal — caller provides full EvalCaseInput.
//   2. One-click from a FindingCard — caller provides `finding` + `action`
//      + optionally `pull_request_id` so the server can load the stored diff.
//
// We merge them into a single discriminated body so the route stays one path.
// `EvalCaseInput` covers the manual path; `EvalCaseOneClickInput` covers the
// one-click path (AC-4). The route handler chooses the service method based on
// which fields are present.
// ---------------------------------------------------------------------------

const EvalCaseCreateBody = z.union([
  // Manual path: full EvalCaseInput (existing expected_output, free-form).
  EvalCaseInput,

  // One-click path (A gap fix): finding + action + optional pull_request_id.
  // The server uses pull_request_id to load the stored PR diff (AC-6).
  EvalCaseOneClickInput,
]);

// ---------------------------------------------------------------------------
// Plugin (exported for T7 to register)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Run-specific schemas (T6)
// ---------------------------------------------------------------------------

/** Body for POST /agents/:id/eval-runs (label is optional). */
const EvalRunBody = z.object({
  /** Optional human label for the run group, e.g. "v7 — tightened rationale". */
  label: z.string().optional(),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // Single plugin-level service instance (SVC-004 — INSIGHTS 2026-07-12).
  // Includes the Container so both case-CRUD and run paths share one instance;
  // the Container gives run-orchestrator paths access to container.llm() without
  // a second construction per handler. Matches the agents/routes.ts convention
  // (one service per plugin, not per-request).
  const svc = new EvalService(app.container.db, app.container);

  // ---- POST /agents/:id/eval-cases ----------------------------------------

  app.post(
    '/agents/:id/eval-cases',
    {
      schema: {
        params: IdParams,
        body: EvalCaseCreateBody,
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const agentId = req.params.id;

      // Discriminate by the presence of `action` (one-click path vs manual).
      const body = req.body;
      let row;
      if ('action' in body) {
        // One-click path: derive expectedOutput from accept/dismiss (AC-4).
        // Thread pull_request_id so the service can load the stored diff (A gap fix).
        row = await svc.createCaseFromFinding(
          workspaceId,
          agentId,
          body.finding,
          body.action,
          body.input_diff,
          body.name,
          body.pull_request_id,
        );
      } else {
        // Manual path: body is already a full EvalCaseInput (validated by Zod).
        row = await svc.createCase(workspaceId, body);
      }

      reply.status(201);
      return row;
    },
  );

  // ---- GET /agents/:id/eval-cases -----------------------------------------

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.listCases(workspaceId, req.params.id);
    },
  );

  // ---- DELETE /agents/:id/eval-cases/:caseId ------------------------------

  app.delete(
    '/agents/:id/eval-cases/:caseId',
    { schema: { params: EvalCaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const deleted = await svc.deleteCase(workspaceId, req.params.caseId);
      if (!deleted) throw new NotFoundError('Eval case not found');
      return { ok: true };
    },
  );

  // ---- POST /agents/:id/eval-runs (T6) ------------------------------------
  //
  // Run the agent over its frozen case set. Returns EvalRunGroupResult.
  // The service instance for run paths includes the Container so it can
  // resolve the LLM provider (AC-6/7/11/13/17).

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: {
        params: IdParams,
        body: EvalRunBody,
        response: { 200: EvalRunGroupResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.runAgentEvals(workspaceId, req.params.id, req.body.label);
    },
  );

  // ---- POST /eval-runs/all (T6, AC-20) ------------------------------------
  //
  // Run ALL enabled agents in the workspace over their own frozen case sets.
  // Returns EvalRunGroupResult[].

  app.post(
    '/eval-runs/all',
    {
      schema: {
        response: { 200: z.array(EvalRunGroupResult) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.runAllAgents(workspaceId);
    },
  );

  // ==========================================================================
  // T7 routes — history / compare / promote / dashboard (AC-15/16/18/20)
  // ==========================================================================

  // ---- GET /agents/:id/eval-runs (T7, AC-15) ------------------------------
  //
  // Run history for an agent: groups newest-first with aggregates + version +
  // cost, enriched with traces_passed / traces_total / pass_rate.
  // Returns EvalDashboard (same contract as the cross-agent dashboard).

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.runHistory(workspaceId, req.params.id);
    },
  );

  // ---- GET /agents/:id/eval-run-groups (T7, AC-16) ------------------------
  //
  // First-class run-group list (newest-first) for the Compare selector. Gives
  // the client REAL run group ids + recorded agent versions so a selected run
  // resolves to an existing group (no synthetic ids / 404 in compare).

  app.get(
    '/agents/:id/eval-run-groups',
    { schema: { params: IdParams, response: { 200: z.array(EvalRunGroup) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.runGroups(workspaceId, req.params.id);
    },
  );

  // ---- POST /agents/:id/eval-compare (T7, AC-16) --------------------------
  //
  // Compare two run groups: per-metric deltas + system_prompt diff between the
  // two recorded agent versions. Degrades to "version unavailable" when a
  // version was pruned (AC-16 graceful degrade edge case).

  app.post(
    '/agents/:id/eval-compare',
    {
      schema: {
        params: IdParams,
        body: EvalCompareBody,
        response: { 200: EvalCompareResult },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.compare(
        workspaceId,
        req.params.id,
        req.body.run_group_id_a,
        req.body.run_group_id_b,
      );
    },
  );

  // ---- POST /agents/:id/promote/:version (T7, AC-18) ----------------------
  //
  // Promote: set the agent's active config to the chosen version snapshot via
  // the EXISTING agent-version mechanism — no parallel versioning scheme (AC-18).

  app.post(
    '/agents/:id/promote/:version',
    { schema: { params: PromoteParams, response: { 200: AgentVersion } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.promote(workspaceId, req.params.id, req.params.version);
    },
  );

  // ---- GET /evals/dashboard (T7, AC-20) -----------------------------------
  //
  // Cross-agent Eval Dashboard: every agent in the workspace with current
  // recall/precision/citation, recent runs, and trend data.

  app.get(
    '/evals/dashboard',
    {
      schema: {
        response: { 200: z.array(EvalDashboard) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return svc.dashboard(workspaceId);
    },
  );
}
