/**
 * Ref-mutating git ops on one clone must not overlap.
 *
 * Two concurrent `git fetch` in the same directory race on
 * `refs/remotes/origin/<branch>`; the loser dies with
 * `cannot lock ref … is at X but expected Y`. Rapid Refresh clicks produced
 * exactly that, because each click queued a clone job and the runner runs three
 * at a time.
 */
import { describe, it, expect } from 'vitest';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

const REPO = { owner: 'acme', name: 'widgets' };

/** Observes overlap by tracking how many wrapped calls are in flight at once. */
function tracker() {
  const state = { active: 0, maxActive: 0, order: [] as string[] };
  const run = async (label: string, ms: number) => {
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    await new Promise((r) => setTimeout(r, ms));
    state.order.push(label);
    state.active--;
  };
  return { state, run };
}

describe('SimpleGitClient — per-clone serialisation', () => {
  it('never runs two mutating ops on one clone at the same time', async () => {
    const client = new SimpleGitClient('/tmp/dd-test-clones');
    const { state, run } = tracker();
    // Drive the private lock the same way the public methods do.
    const lock = (label: string, ms: number) =>
      (client as unknown as {
        withRepoLock: <T>(r: typeof REPO, f: () => Promise<T>) => Promise<T>;
      }).withRepoLock(REPO, () => run(label, ms));

    await Promise.all([lock('a', 30), lock('b', 5), lock('c', 5)]);

    expect(state.maxActive).toBe(1);
    // Serialised in submission order, not completion order — 'a' is slowest and
    // still finishes first.
    expect(state.order).toEqual(['a', 'b', 'c']);
  });

  it('a failed op does not wedge the queue', async () => {
    const client = new SimpleGitClient('/tmp/dd-test-clones');
    const lock = (client as unknown as {
      withRepoLock: <T>(r: typeof REPO, f: () => Promise<T>) => Promise<T>;
    }).withRepoLock.bind(client);

    const failed = lock(REPO, async () => {
      throw new Error('cannot lock ref');
    });
    await expect(failed).rejects.toThrow('cannot lock ref');
    await expect(lock(REPO, async () => 'ok')).resolves.toBe('ok');
  });

  it('different clones are independent', async () => {
    const client = new SimpleGitClient('/tmp/dd-test-clones');
    const { state, run } = tracker();
    const lock = (client as unknown as {
      withRepoLock: <T>(r: { owner: string; name: string }, f: () => Promise<T>) => Promise<T>;
    }).withRepoLock.bind(client);

    await Promise.all([
      lock({ owner: 'acme', name: 'one' }, () => run('one', 20)),
      lock({ owner: 'acme', name: 'two' }, () => run('two', 20)),
    ]);

    // Two different repos may fetch at once; the lock is per clone directory.
    expect(state.maxActive).toBe(2);
  });
});
