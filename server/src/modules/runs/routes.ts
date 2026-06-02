import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { RunsService } from './service.js';
import { MemoryCurator } from './curator.js';

/**
 * A5 — runs / observability module (§12, owner A5).
 *
 *   POST /pulls/:id/multi-agent-run   → run all enabled agents in parallel (p-queue)
 *                                       + built-in Lethal-Trifecta; returns columns+conflicts
 *   GET  /pulls/:id/multi-agent       → latest assembled multi-agent run for a PR
 *   GET  /multi-agent-runs/:id        → a specific assembled multi-agent run
 *   GET  /agents/:id/stats            → per-agent accept/dismiss/findings/cost/latency aggregates
 *   POST /memory/curate               → cross-session memory curator (dedupe/merge); ?dryRun
 *
 * NOTE: A5 deliberately does NOT register `GET /runs/:id/trace` or
 * `GET /runs/:id/events` — A2 owns those. The trace document A2 (and A5's
 * multi-agent / trifecta paths) write is ENRICHED via the shared trace builder
 * (`platform/trace-builder.ts`), so the already-registered `/runs/:id/trace`
 * returns the full single-document RunTrace without a new route.
 */

const MultiAgentRunBody = z
  .object({
    agentIds: z.array(z.string()).optional(),
    includeTrifecta: z.boolean().optional(),
  })
  .optional();

const CurateBody = z
  .object({
    threshold: z.number().min(0).max(1).optional(),
    dryRun: z.boolean().optional(),
  })
  .optional();

export default async function runsRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new RunsService(container);
  const curator = new MemoryCurator(container);

  // Register the fan-out + curator job handlers once (idempotent).
  service.registerJobHandler();
  curator.registerJobHandler();

  // ---- Multi-Agent Review -------------------------------------------------
  app.post<{ Params: { id: string } }>('/pulls/:id/multi-agent-run', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = MultiAgentRunBody.parse(req.body ?? undefined) ?? {};
    return service.runMultiAgent(workspaceId, req.params.id, {
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
      ...(body.includeTrifecta !== undefined ? { includeTrifecta: body.includeTrifecta } : {}),
    });
  });

  app.get<{ Params: { id: string } }>('/pulls/:id/multi-agent', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const run = await service.latestForPull(workspaceId, req.params.id);
    if (!run) throw new NotFoundError('No multi-agent run for this PR yet');
    return run;
  });

  app.get<{ Params: { id: string } }>('/multi-agent-runs/:id', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.assembleMultiAgentRun(workspaceId, req.params.id);
  });

  // ---- Per-agent Stats ----------------------------------------------------
  app.get<{ Params: { id: string } }>('/agents/:id/stats', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.agentStats(workspaceId, req.params.id);
  });

  // ---- Cross-session memory curator --------------------------------------
  app.post('/memory/curate', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = CurateBody.parse(req.body ?? undefined) ?? {};
    return curator.curate(workspaceId, {
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
      ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
    });
  });
}
