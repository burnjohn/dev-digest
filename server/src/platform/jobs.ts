import PQueue from 'p-queue';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as t from '../db/schema.js';
import { withTimeout, withRetry } from './resilience.js';

/**
 * JobRunner — async work (clone, PR import, indexing, polling) on a
 * concurrency-limited p-queue, mirrored into the `jobs` table with
 * timeouts + retry/backoff.
 *
 * Handlers are registered by kind. enqueue() inserts a `jobs` row, schedules
 * the handler on the queue, and updates status/attempts/error as it runs.
 */

export type JobHandler = (payload: unknown, ctx: { jobId: string }) => Promise<void>;

/**
 * Strip credentials embedded in URLs (https://user:token@host/…) from a
 * message before it is persisted. git anonymizes URLs in its own error
 * output, but `jobs.error` is shared by every job kind — present and future —
 * and is now visible to clients via GET /jobs/:id, so the guarantee has to
 * live at this chokepoint rather than in git.
 */
export function redactUrlCredentials(message: string): string {
  return message.replace(/(https?:\/\/)[^@/\s]+@/gi, '$1***@');
}

export interface JobRunnerOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface EnqueuedJob {
  id: string;
  /** Resolves when the job finishes (or rejects if it ultimately fails). */
  done: Promise<void>;
}

export class JobRunner {
  private queue: PQueue;
  private handlers = new Map<string, JobHandler>();
  private timeoutMs: number;
  private retries: number;

  constructor(
    private db: Db,
    opts: JobRunnerOptions = {},
  ) {
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 3 });
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.retries = opts.retries ?? 2;
  }

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(workspaceId: string, kind: string, payload: unknown): Promise<EnqueuedJob> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`No job handler registered for kind '${kind}'`);

    const [row] = await this.db
      .insert(t.jobs)
      .values({ workspaceId, kind, payload: payload as object, status: 'queued' })
      .returning({ id: t.jobs.id });
    const jobId = row!.id;

    const done = this.queue.add(async () => {
      await this.db
        .update(t.jobs)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(t.jobs.id, jobId));
      try {
        await withRetry(
          () =>
            withTimeout(handler(payload, { jobId }), this.timeoutMs).then(async () => {
              await this.db
                .update(t.jobs)
                .set({ attempts: 1 })
                .where(eq(t.jobs.id, jobId));
            }),
          {
            retries: this.retries,
            onRetry: async (attempt) => {
              await this.db
                .update(t.jobs)
                .set({ attempts: attempt })
                .where(eq(t.jobs.id, jobId));
            },
          },
        );
        await this.db
          .update(t.jobs)
          .set({ status: 'done', finishedAt: new Date() })
          .where(eq(t.jobs.id, jobId));
      } catch (err) {
        await this.db
          .update(t.jobs)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            error: redactUrlCredentials((err as Error).message),
          })
          .where(eq(t.jobs.id, jobId));
        throw err;
      }
    }) as Promise<void>;

    // Jobs are fire-and-forget: every caller drops `done` on the floor. The
    // rethrow above is still wanted for anyone who DOES await it, but an
    // unobserved rejection takes the whole process down — a failed clone, a
    // git ref race, a timeout, any of them killed the API outright. Attaching a
    // handler here marks the promise observed; a caller who awaits `done` is
    // unaffected and still sees the rejection.
    done.catch(() => undefined);

    return { id: jobId, done };
  }

  /**
   * Fail jobs left 'queued'/'running' by a previous (now-dead) process. The
   * queue is in-memory, so nothing will ever finish those rows — and since
   * refresh dedupes onto the active job, a ghost row would make every refresh
   * return a job that never completes. Call on boot, before listening; same
   * single-instance assumption as the stale-run reaper in app.ts.
   */
  async reapOrphans(): Promise<number> {
    const rows = await this.db
      .update(t.jobs)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: 'orphaned by server restart',
      })
      .where(inArray(t.jobs.status, ['queued', 'running']))
      .returning({ id: t.jobs.id });
    return rows.length;
  }

  /** Wait for the queue to drain (useful in tests). */
  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }
}
