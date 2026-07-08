/**
 * Route tests for GET /pulls/:id/blast.
 *
 * Hermetic: no Postgres, no Docker.
 *
 * Strategy:
 *  - Build the app with MockAuthProvider (known workspaceId) and a mock
 *    repoIntel. Then, before the first request, patch container.db with a
 *    Drizzle-compatible mock that answers BlastRepository's select queries
 *    and also reset service._repo so the lazy init picks up the mock db.
 *  - For 422/invalid UUID tests: no DB needed (Zod param validation fires first).
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { BlastResponse } from '@devdigest/shared';
import {
  MockAuthProvider,
} from '../src/adapters/mocks.js';
import type { RepoIntel, BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import type { FastifyInstance } from 'fastify';
import type { BlastService } from '../src/modules/blast/service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PR_ID = '11111111-1111-1111-1111-111111111111';
const WS_ID = '22222222-2222-2222-2222-222222222222';
const REPO_ID = '33333333-3333-3333-3333-333333333333';
const INVALID_ID = 'not-a-uuid';

// ---------------------------------------------------------------------------
// Fake DB factory
// ---------------------------------------------------------------------------

type SelectResult = Record<string, unknown>[];

/**
 * Returns a mock `db` that satisfies Drizzle's PostgresJsDatabase interface
 * well enough for BlastRepository's select queries. Each `.select()` call
 * starts a new query builder chain; `.limit(n)` or awaiting the chain
 * returns the rows configured here.
 *
 * We sniff the table being queried by detecting which columns are selected
 * (Drizzle passes the column map to `select({...})`).
 */
function makeDb(opts: {
  prRow?: Record<string, unknown> | null;
  prFileRows?: { path: string }[];
  priorPrRows?: Record<string, unknown>[];
  repoRow?: Record<string, unknown> | null;
}) {
  function makeChain(resolve: () => SelectResult): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      groupBy: (..._args: unknown[]) => chain,
      orderBy: (..._args: unknown[]) => chain,
      limit: (_n: number) => Promise.resolve(resolve()),
      // Make the chain itself thenable so `await chain` works for non-limited queries.
      then: (
        onFulfilled?: (value: SelectResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).catch(onRejected),
    };
    return chain;
  }

  let callIndex = 0;

  return {
    select: (_columns?: Record<string, unknown>) => {
      // Track which call this is — BlastRepository makes calls in order:
      // 1. getPr (pullRequests)  → .limit(1)
      // 2. getPrFilePaths (prFiles + innerJoin pullRequests) → awaited directly
      // 3. getPriorPrs (pullRequests + innerJoin prFiles) → awaited directly
      // 4. getRepoBasics (repos) → .limit(1)
      const myIndex = callIndex++;

      return makeChain(() => {
        if (myIndex === 0) {
          // getPr
          const row = 'prRow' in opts ? opts.prRow : {
            id: PR_ID, repoId: REPO_ID, headSha: 'deadbeef', number: 42,
          };
          return row ? [row] : [];
        }
        if (myIndex === 1) {
          // getPrFilePaths
          return (opts.prFileRows ?? [{ path: 'src/utils.ts' }]) as SelectResult;
        }
        if (myIndex === 2) {
          // getPriorPrs
          return (opts.priorPrRows ?? []) as SelectResult;
        }
        // getRepoBasics
        const repoRow = 'repoRow' in opts ? opts.repoRow : { owner: 'acme', name: 'api' };
        return repoRow ? [repoRow] : [];
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Mock RepoIntel
// ---------------------------------------------------------------------------

function makeRepoIntel(opts: {
  indexState?: Partial<IndexState>;
  blastResult?: Partial<BlastResult>;
  importers?: string[];
}): RepoIntel {
  const defaultBlast: BlastResult = {
    changedSymbols: [{ name: 'myFn', file: 'src/utils.ts', kind: 'function' }],
    callers: [
      { file: 'src/router.ts', symbol: 'routeHandler', viaSymbol: 'myFn', line: 10, rank: 5 },
    ],
    impactedEndpoints: ['GET /api/health'],
    factsByFile: {
      'src/router.ts': { endpoints: ['GET /api/health'], crons: [] },
    },
  };

  const defaultIndexState: IndexState = {
    repoId: REPO_ID,
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    durationMs: 500,
    lastIndexedSha: 'abc',
    indexerVersion: 1,
    updatedAt: new Date('2026-01-01'),
    degraded: false,
  };

  return {
    getIndexState: vi.fn().mockResolvedValue({ ...defaultIndexState, ...opts.indexState }),
    getBlastRadius: vi.fn().mockResolvedValue({ ...defaultBlast, ...opts.blastResult }),
    getImporters: vi.fn().mockResolvedValue(opts.importers ?? []),
    indexRepo: vi.fn(),
    refreshIndex: vi.fn(),
    getRepoMap: vi.fn(),
    getFileRank: vi.fn(),
    getSymbolsInFiles: vi.fn(),
    getCallerSignatures: vi.fn(),
    getUnresolvedReferences: vi.fn(),
    getConventionSamples: vi.fn(),
    getTopFilesByRank: vi.fn(),
    getCriticalPaths: vi.fn(),
  } as RepoIntel;
}

// ---------------------------------------------------------------------------
// App builder helper
// ---------------------------------------------------------------------------

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

async function buildBlastApp(opts: {
  prRow?: Record<string, unknown> | null;
  prFileRows?: { path: string }[];
  priorPrRows?: Record<string, unknown>[];
  repoRow?: Record<string, unknown> | null;
  indexState?: Partial<IndexState>;
  blastResult?: Partial<BlastResult>;
}): Promise<FastifyInstance> {
  const repoIntel = makeRepoIntel({
    indexState: opts.indexState,
    blastResult: opts.blastResult,
  });

  const mockAuth = new MockAuthProvider(
    { id: 'u1', email: 'you@local', name: 'You' },
    { id: WS_ID, name: 'default' },
  );

  const app = await buildApp({
    config,
    overrides: { repoIntel, auth: mockAuth },
  });

  // Swap the db on the container so BlastRepository picks up the mock.
  // The lazy `_repo` in BlastService is null until first call, so this is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.container as any).db = makeDb(opts);

  // The blast routes plugin constructs BlastService(container) once at load
  // time. We need to reset its cached _repo so it creates a new one with the
  // patched db on the next request.
  // Access the service instance through the Fastify plugin's closure is not
  // straightforward; instead we leverage the lazy getter — since _repo was
  // never accessed during app init, it's still null when the first request hits.
  // (BlastService is built fresh per plugin init but repo is lazy-init per call.)

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /pulls/:id/blast — 400 invalid UUID (no DB needed)', () => {
  it('returns 422 for a non-UUID param', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${INVALID_ID}/blast`,
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('GET /pulls/:id/blast — 404 unknown PR', () => {
  it('returns 404 when PR does not exist in the workspace', async () => {
    const app = await buildBlastApp({ prRow: null });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${PR_ID}/blast`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /pulls/:id/blast — 200 success', () => {
  it('returns 200 with a valid BlastResponse body', async () => {
    const app = await buildBlastApp({});
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${PR_ID}/blast`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Zod-parse the body to verify the shape matches BlastResponse.
    const parsed = BlastResponse.safeParse(body);
    if (!parsed.success) {
      console.error('BlastResponse parse error:', parsed.error.format());
    }
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data.available).toBe(true);
      expect(parsed.data.blast).not.toBeNull();
      expect(parsed.data.index).toBeDefined();
      expect(parsed.data.link).not.toBeNull();
    }
  });

  it('returns available:false when no symbols found (empty blast)', async () => {
    const app = await buildBlastApp({
      blastResult: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
        factsByFile: undefined,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${PR_ID}/blast`,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(false);
    expect(body.blast).toBeNull();
  });
});

describe('GET /pulls/:id/blast — workspace scoping', () => {
  it('returns 404 when PR belongs to a different workspace (scoped query returns null)', async () => {
    // MockAuthProvider returns WS_ID as the current workspace.
    // BlastRepository.getPr() will join on workspace_id=WS_ID.
    // By returning prRow: null, we simulate a PR that exists in OTHER_WS but not WS_ID.
    const app = await buildBlastApp({ prRow: null });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${PR_ID}/blast`,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});
