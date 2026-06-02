import type { FastifyInstance } from 'fastify';
import { FindingActionKind, RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from './service.js';

/**
 * A2 — reviews module (§12, owner A2).
 *   POST /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs+reviews
 *   GET  /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET  /runs/:id/trace                             → the single-document RunTrace (basic; A5 enriches)
 *   GET  /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   GET  /pulls/:id/intent                           → derived PR intent (in/out of scope)
 *   GET  /pulls/:id/smart-diff                       → Smart Diff groups + split nudge
 *   POST /findings/:id/(accept|dismiss|learn|reply)  → finding actions (learn→memory)
 */
export default async function reviewsRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger; §8.1) -------------------------------
  app.post<{ Params: { id: string } }>('/pulls/:id/review', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = RunRequest.parse(req.body ?? {});
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(workspaceId, req.params.id, targets);
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  app.get<{ Params: { id: string } }>('/runs/:id/events', async (req, reply) => {
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

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get<{ Params: { id: string } }>('/runs/:id/trace', async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/pulls/:id/reviews', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/pulls/:id/intent', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const intent = await service.getIntent(workspaceId, req.params.id);
    if (!intent) throw new NotFoundError('No intent derived for this PR yet');
    return { pr_id: req.params.id, ...intent };
  });

  app.get<{ Params: { id: string } }>('/pulls/:id/smart-diff', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.smartDiff(workspaceId, req.params.id);
  });

  // ---- Finding actions ----------------------------------------------------
  for (const action of FindingActionKind.options) {
    app.post<{ Params: { id: string }; Body: { reply?: string } }>(
      `/findings/:id/${action}`,
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        const reply = (req.body ?? {}).reply;
        const result = await service.actOnFinding(workspaceId, req.params.id, action, reply);
        return result;
      },
    );
  }
}
