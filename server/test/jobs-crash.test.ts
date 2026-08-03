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
import { JobRunner, redactUrlCredentials } from '../src/platform/jobs.js';

/** Minimal Db stand-in: the runner only writes bookkeeping rows. */
const updates: Record<string, unknown>[] = [];
const db = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'job-1' }] }) }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updates.push(values);
      return { where: async () => undefined };
    },
  }),
} as never;

describe('JobRunner — an unobserved failure', () => {
  const seen: unknown[] = [];
  const onUnhandled = (e: unknown) => seen.push(e);

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    seen.length = 0;
    updates.length = 0;
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

  it('scrubs URL-embedded credentials from the persisted error', async () => {
    const runner = new JobRunner(db, { retries: 0, timeoutMs: 500 });
    runner.register('boom', async () => {
      // git anonymizes its own errors, but not every failure path is git's —
      // jobs.error is client-visible via GET /jobs/:id, so the runner scrubs.
      throw new Error(
        "fatal: unable to access 'https://x-access-token:ghp_secret123@github.com/acme/widgets.git/'",
      );
    });

    const { done } = await runner.enqueue('ws-1', 'boom', {});
    await done.catch(() => undefined);

    const failed = updates.find((u) => u.status === 'failed');
    expect(failed?.error).toContain('https://***@github.com/acme/widgets.git');
    expect(JSON.stringify(updates)).not.toContain('ghp_secret123');
  });
});

describe('redactUrlCredentials', () => {
  it('strips userinfo from URLs and leaves everything else alone', () => {
    expect(redactUrlCredentials('https://user:tok@host/p and http://tok@h2/x')).toBe(
      'https://***@host/p and http://***@h2/x',
    );
    expect(redactUrlCredentials('plain text, no urls')).toBe('plain text, no urls');
    expect(redactUrlCredentials('https://github.com/acme/widgets.git')).toBe(
      'https://github.com/acme/widgets.git',
    );
  });
});
