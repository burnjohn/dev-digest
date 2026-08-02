/**
 * A failing background job must not take the process down.
 *
 * JobRunner.enqueue records the failure and rethrows into `done`. Every caller
 * drops `done`, so the rejection was unobserved and Node killed the API — a
 * failed clone, a git ref race and a job timeout each did it during one
 * afternoon. The rethrow is kept for anyone who awaits; it just must not be
 * the process's problem when nobody does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';

/** Minimal Db stand-in: the runner only writes bookkeeping rows. */
const db = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
} as never;

describe('JobRunner — an unobserved failure', () => {
  const seen: unknown[] = [];
  const onUnhandled = (e: unknown) => seen.push(e);

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    seen.length = 0;
  });

  it('does not raise an unhandled rejection when nobody awaits `done`', async () => {
    process.on('unhandledRejection', onUnhandled);
    const runner = new JobRunner(db, { retries: 0, timeoutMs: 500 });
    runner.register('boom', async () => {
      throw new Error('git ref race');
    });

    await runner.enqueue('ws-1', 'boom', {}); // `done` deliberately ignored
    await runner.onIdle();
    // Give the microtask queue a turn — that is when Node reports the rejection.
    await new Promise((r) => setTimeout(r, 50));

    expect(seen).toEqual([]);
  });

  it('still rejects for a caller that DOES await it', async () => {
    const runner = new JobRunner(db, { retries: 0, timeoutMs: 500 });
    runner.register('boom', async () => {
      throw new Error('git ref race');
    });

    const { done } = await runner.enqueue('ws-1', 'boom', {});
    await expect(done).rejects.toThrow('git ref race');
  });
});
