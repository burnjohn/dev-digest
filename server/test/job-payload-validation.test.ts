import { describe, it, expect } from 'vitest';
import type { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';
import { RepoService } from '../src/modules/repos/service.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';

/**
 * Job payloads round-trip through the `jobs.payload` jsonb column, so the
 * consumer side is a trust boundary: a handler must PARSE the payload it
 * receives, not cast it. These tests capture the registered handlers and feed
 * them malformed payloads — a compliant handler rejects with a ZodError before
 * touching any adapter or the database.
 */

type Registered = Map<string, (payload: unknown, ctx: { jobId: string }) => Promise<void>>;

function fakeContainer(registered: Registered): Container {
  return {
    db: {} as Db,
    jobs: {
      register: (kind: string, handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>) => {
        registered.set(kind, handler);
      },
    },
    secrets: {
      get: async () => undefined,
    },
    git: {
      clone: async () => ({ path: '/tmp/never-reached' }),
    },
  } as unknown as Container;
}

const isZodError = (e: unknown) => (e as Error).name === 'ZodError';

describe('clone job payload validation', () => {
  it('rejects a malformed clone payload with a ZodError before doing any work', async () => {
    const registered: Registered = new Map();
    new RepoService(fakeContainer(registered)).registerCloneJobHandler();
    const handler = registered.get('clone');
    expect(handler).toBeDefined();
    await expect(handler!({ repoId: 123 }, { jobId: 'j1' })).rejects.toSatisfy(isZodError);
  });
});

describe('repo-intel job payload validation', () => {
  it('rejects malformed index/refresh/resync payloads with a ZodError', async () => {
    const registered: Registered = new Map();
    new RepoIntelService(fakeContainer(registered)).registerIndexJobHandlers();
    expect(registered.size).toBe(3);
    for (const [kind, handler] of registered) {
      await expect(handler({}, { jobId: 'j1' }), kind).rejects.toSatisfy(isZodError);
    }
  });
});
