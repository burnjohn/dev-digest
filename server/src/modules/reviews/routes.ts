import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';
import * as pullRepo from './repository/pull.repo.js';
import * as t from '../../db/schema.js';

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    await getContext(container, req);
    const runId = req.params.id;

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    await service.cancelRun(req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Single review + its findings (workspace-scoped via PR) -------------
  app.get('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const review = await service.getReview(workspaceId, req.params.id);
    if (!review) throw new NotFoundError('Review not found');
    return review;
  });

  // ---- PR Brief (intent + blast radius + risks + prior-PR history) ---------
  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const pull = await pullRepo.getPull(container.db, workspaceId, req.params.id);
    if (!pull) throw new NotFoundError('PR not found');
    const brief = await pullRepo.getBrief(container.db, req.params.id);
    return brief ?? null;
  });

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Bulk: trigger reviews for all open PRs in a repo -------------------
  // Fire-and-forget: reviews run in background, returns count immediately.
  app.post('/repos/:id/review-all', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    // Verify repo belongs to this workspace before touching any data.
    const [repo] = await container.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');
    const openPrs = await container.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, req.params.id),
        eq(t.pullRequests.status, 'open'),
      ));
    if (openPrs.length === 0) return { triggered: 0 };
    // Exclude PRs that already have a running review — double-clicking or a race
    // with the polling trigger would otherwise create duplicate agent_runs rows
    // and duplicate findings for the same PR.
    const runningRows = await container.db
      .select({ prId: t.agentRuns.prId })
      .from(t.agentRuns)
      .where(and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.prId, openPrs.map((p) => p.id)),
        eq(t.agentRuns.status, 'running'),
      ));
    const runningPrIds = new Set(runningRows.map((r) => r.prId));
    const eligiblePrs = openPrs.filter((p) => !runningPrIds.has(p.id));
    if (eligiblePrs.length === 0) return { triggered: 0 };
    const targets = await service.resolveTargets(workspaceId, { all: true });
    // Concurrency cap: avoids saturating the LLM provider rate limit and the
    // in-process runBus when many PRs are open. New slots open as each run settles.
    const CONCURRENCY = 3;
    const prIds = eligiblePrs.map((p) => p.id);
    let head = 0;
    let active = 0;
    function scheduleNext(): void {
      while (active < CONCURRENCY && head < prIds.length) {
        const prId = prIds[head++]!;
        active++;
        service.runReview(workspaceId, prId, targets, req.log)
          .catch((err: Error) => {
            req.log.error({ err, prId }, 'review-all: review failed');
          })
          .finally(() => {
            active--;
            scheduleNext();
          });
      }
    }
    scheduleNext();
    return { triggered: prIds.length };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }

  // ---- Unified finding action endpoint ------------------------------------
  app.post('/findings/:id/action', {
    schema: {
      params: IdParams,
      body: z.object({ action: z.enum(['accept', 'dismiss']) }),
    },
  }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.actOnFinding(workspaceId, req.params.id, req.body.action);
  });
}
