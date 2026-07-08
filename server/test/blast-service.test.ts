/**
 * Unit tests for BlastService.
 *
 * Hermetic: no Postgres, no Docker. The repository and repoIntel facade are
 * stubbed via vi.fn() so we exercise the assembly logic in isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastResponse } from '@devdigest/shared';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import type { PrHistoryItem } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal BlastResult fixture. */
function makeBlastResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [{ name: 'myFn', file: 'src/utils.ts', kind: 'function' }],
    callers: [
      { file: 'src/router.ts', symbol: 'routeHandler', viaSymbol: 'myFn', line: 10, rank: 5 },
    ],
    impactedEndpoints: ['GET /api/health'],
    ...overrides,
  };
}

/** Build a minimal IndexState fixture. */
function makeIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    durationMs: 500,
    lastIndexedSha: 'abc',
    indexerVersion: 1,
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const PR_ID = '11111111-1111-1111-1111-111111111111';
const WS_ID = '22222222-2222-2222-2222-222222222222';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

const PR_ROW = { id: PR_ID, repoId: REPO_ID, headSha: 'deadbeef', number: 42 };

/** Build a BlastService with all dependencies stubbed. */
function buildService(opts: {
  pr?: typeof PR_ROW | null;
  files?: string[];
  blastResult?: BlastResult;
  indexState?: IndexState;
  priorPrs?: PrHistoryItem[];
  repoBasics?: { owner: string; name: string } | null;
}): BlastService {
  const pr = 'pr' in opts ? opts.pr : PR_ROW;
  const files = opts.files ?? ['src/utils.ts'];
  const blastResult = opts.blastResult ?? makeBlastResult();
  const indexState = opts.indexState ?? makeIndexState();
  const priorPrs = opts.priorPrs ?? [];
  const repoBasics = 'repoBasics' in opts ? opts.repoBasics : { owner: 'acme', name: 'api' };

  const mockRepo = {
    getPr: vi.fn().mockResolvedValue(pr),
    getPrFilePaths: vi.fn().mockResolvedValue(files),
    getPriorPrs: vi.fn().mockResolvedValue(priorPrs),
    getRepoBasics: vi.fn().mockResolvedValue(repoBasics),
  };

  const mockRepoIntel = {
    getIndexState: vi.fn().mockResolvedValue(indexState),
    getBlastRadius: vi.fn().mockResolvedValue(blastResult),
  };

  const container = {
    db: {} as never,
    repoIntel: mockRepoIntel,
  } as never;

  // Inject the mock repository via the constructor override.
  const svc = new BlastService(
    container,
    mockRepo as unknown as import('../src/modules/blast/repository.js').BlastRepository,
  );

  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlastService — smoke', () => {
  it('exposes getBlast', () => {
    // TODO: assert on the real output shape instead of just the method's presence
    expect(typeof BlastService.prototype.getBlast).toBe('function');
  });
});

describe('BlastService.getBlast — 404 when PR not found', () => {
  it('throws NotFoundError when PR is missing', async () => {
    const svc = buildService({ pr: null });
    await expect(svc.getBlast(WS_ID, PR_ID)).rejects.toThrow('PR not found');
  });
});

describe('BlastService.getBlast — grouping callers by viaSymbol', () => {
  it('groups callers by viaSymbol and populates downstream', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'fn1', file: 'src/a.ts', kind: 'function' },
        { name: 'fn2', file: 'src/b.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'handler1', viaSymbol: 'fn1', line: 5, rank: 1 },
        { file: 'src/d.ts', symbol: 'handler2', viaSymbol: 'fn1', line: 8, rank: 2 },
        { file: 'src/e.ts', symbol: 'handler3', viaSymbol: 'fn2', line: 12, rank: 3 },
      ],
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    expect(result.available).toBe(true);
    expect(result.blast!.downstream).toHaveLength(2);

    const fn1Impact = result.blast!.downstream.find((d) => d.symbol === 'fn1')!;
    const fn2Impact = result.blast!.downstream.find((d) => d.symbol === 'fn2')!;

    expect(fn1Impact.callers).toHaveLength(2);
    expect(fn2Impact.callers).toHaveLength(1);
  });

  it('excludes changed symbols with zero callers from downstream', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'fn1', file: 'src/a.ts', kind: 'function' },
        { name: 'unusedFn', file: 'src/a.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'handler1', viaSymbol: 'fn1', line: 5, rank: 1 },
      ],
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    // unusedFn stays in changed_symbols (the stat) but has no tree entry.
    expect(result.blast!.changed_symbols).toHaveLength(2);
    expect(result.blast!.downstream).toHaveLength(1);
    expect(result.blast!.downstream[0]!.symbol).toBe('fn1');
  });
});

describe('BlastService.getBlast — 20-per-symbol clamp + truncated', () => {
  it('caps callers at 20 per symbol and records hidden count in truncated', async () => {
    // Create 25 callers for 'myFn'.
    const callers = Array.from({ length: 25 }, (_, i) => ({
      file: `src/file${i}.ts`,
      symbol: `handler${i}`,
      viaSymbol: 'myFn',
      line: i + 1,
      rank: i,
    }));

    const blastResult = makeBlastResult({ callers });
    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    const myFnImpact = result.blast!.downstream[0]!;
    expect(myFnImpact.callers).toHaveLength(20);
    expect(result.truncated?.['myFn']).toBe(5); // 25 - 20 = 5 hidden
  });

  it('does not add truncated key when callers <= 20', async () => {
    const svc = buildService({}); // default: 1 caller
    const result = await svc.getBlast(WS_ID, PR_ID);
    expect(result.truncated).toBeUndefined();
  });
});

describe('BlastService.getBlast — endpoint attribution from factsByFile', () => {
  it('attributes endpoints/crons from factsByFile for each symbol\'s caller files', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'fn1', file: 'src/a.ts', kind: 'function' },
        { name: 'fn2', file: 'src/b.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'handler1', viaSymbol: 'fn1', line: 5, rank: 1 },
        { file: 'src/d.ts', symbol: 'handler2', viaSymbol: 'fn2', line: 8, rank: 2 },
      ],
      impactedEndpoints: ['GET /fallback'],
      factsByFile: {
        'src/c.ts': { endpoints: ['GET /api/users'], crons: ['cron-a'] },
        'src/d.ts': { endpoints: ['POST /api/orders'], crons: [] },
      },
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    const fn1 = result.blast!.downstream.find((d) => d.symbol === 'fn1')!;
    const fn2 = result.blast!.downstream.find((d) => d.symbol === 'fn2')!;

    expect(fn1.endpoints_affected).toContain('GET /api/users');
    expect(fn1.crons_affected).toContain('cron-a');
    expect(fn2.endpoints_affected).toContain('POST /api/orders');
    // No cross-attribution: fn2's endpoint never leaks onto fn1 and vice versa.
    expect(fn1.endpoints_affected).not.toContain('POST /api/orders');
    expect(fn2.endpoints_affected).not.toContain('GET /api/users');
  });

  it('excludes registration-hub caller files (endpoint count > HUB limit) from attribution', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'reaper', file: 'src/reaper.ts', kind: 'function' },
        { name: 'listItems', file: 'src/items.ts', kind: 'function' },
      ],
      callers: [
        // reaper is only referenced from the bootstrap hub (app.ts).
        { file: 'src/app.ts', symbol: 'bootstrap', viaSymbol: 'reaper', line: 81, rank: 1 },
        // listItems is called from a real route module.
        { file: 'src/routes/items.ts', symbol: 'itemsRoute', viaSymbol: 'listItems', line: 12, rank: 2 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        // app.ts registers the whole app → 6 endpoints (> HUB_ENDPOINT_LIMIT of 5).
        'src/app.ts': {
          endpoints: ['GET /health', 'GET /a', 'GET /b', 'POST /c', 'DELETE /d', 'GET /e'],
          crons: [],
        },
        'src/routes/items.ts': { endpoints: ['GET /items'], crons: [] },
      },
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    const reaper = result.blast!.downstream.find((d) => d.symbol === 'reaper')!;
    const listItems = result.blast!.downstream.find((d) => d.symbol === 'listItems')!;

    // Hub endpoints are NOT dumped onto the reaper; the real route module is kept.
    expect(reaper.endpoints_affected).toEqual([]);
    expect(listItems.endpoints_affected).toEqual(['GET /items']);
  });

  it('excludes test-file "endpoints" (inject targets) from attribution', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [{ name: 'fn1', file: 'src/a.ts', kind: 'function' }],
      callers: [
        { file: 'src/routes.ts', symbol: 'h1', viaSymbol: 'fn1', line: 5, rank: 1 },
        { file: 'test/routes.it.test.ts', symbol: 't1', viaSymbol: 'fn1', line: 9, rank: 0 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        'src/routes.ts': { endpoints: ['GET /real'], crons: [] },
        // Test-case URLs must never surface as endpoints.
        'test/routes.it.test.ts': { endpoints: ['GET /agents/${ghost}/versions'], crons: [] },
      },
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    const fn1 = result.blast!.downstream.find((d) => d.symbol === 'fn1')!;
    expect(fn1.endpoints_affected).toEqual(['GET /real']);
  });

  it('orders downstream by impact: endpoints+crons desc, then callers desc', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'noApi', file: 'src/a.ts', kind: 'function' },
        { name: 'withApi', file: 'src/b.ts', kind: 'function' },
        { name: 'manyCallers', file: 'src/e.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'h1', viaSymbol: 'noApi', line: 1, rank: 1 },
        { file: 'src/d.ts', symbol: 'h2', viaSymbol: 'withApi', line: 2, rank: 2 },
        { file: 'src/f.ts', symbol: 'h3', viaSymbol: 'manyCallers', line: 3, rank: 3 },
        { file: 'src/g.ts', symbol: 'h4', viaSymbol: 'manyCallers', line: 4, rank: 4 },
      ],
      impactedEndpoints: [],
      factsByFile: {
        'src/c.ts': { endpoints: [], crons: [] },
        'src/d.ts': { endpoints: ['GET /api'], crons: [] },
        'src/f.ts': { endpoints: [], crons: [] },
        'src/g.ts': { endpoints: [], crons: [] },
      },
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    // withApi (1 endpoint) first, then manyCallers (0 endpoints, 2 callers), then noApi.
    expect(result.blast!.downstream.map((d) => d.symbol)).toEqual([
      'withApi',
      'manyCallers',
      'noApi',
    ]);
  });
});

describe('BlastService.getBlast — degraded fallback attribution', () => {
  it('attributes impactedEndpoints to first symbol when factsByFile is absent', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [
        { name: 'fn1', file: 'src/a.ts', kind: 'function' },
        { name: 'fn2', file: 'src/b.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'h1', viaSymbol: 'fn1', line: 5, rank: 0 },
        { file: 'src/d.ts', symbol: 'h2', viaSymbol: 'fn2', line: 8, rank: 0 },
      ],
      impactedEndpoints: ['GET /api/health'],
      degraded: true,
      reason: 'no_data',
      // No factsByFile
    };

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    const fn1 = result.blast!.downstream.find((d) => d.symbol === 'fn1')!;
    const fn2 = result.blast!.downstream.find((d) => d.symbol === 'fn2')!;

    // First symbol gets the impactedEndpoints; second gets none.
    expect(fn1.endpoints_affected).toEqual(['GET /api/health']);
    expect(fn2.endpoints_affected).toEqual([]);
  });
});

describe('BlastService.getBlast — deterministic summary', () => {
  it('builds correct summary string from counts', async () => {
    const blastResult = makeBlastResult({
      changedSymbols: [
        { name: 'fn1', file: 'src/a.ts', kind: 'function' },
        { name: 'fn2', file: 'src/b.ts', kind: 'function' },
      ],
      callers: [
        { file: 'src/c.ts', symbol: 'h1', viaSymbol: 'fn1', line: 5, rank: 1 },
        { file: 'src/d.ts', symbol: 'h2', viaSymbol: 'fn1', line: 8, rank: 2 },
        { file: 'src/e.ts', symbol: 'h3', viaSymbol: 'fn2', line: 12, rank: 3 },
      ],
      factsByFile: {
        'src/c.ts': { endpoints: ['GET /a'], crons: [] },
        'src/d.ts': { endpoints: ['POST /b'], crons: ['cron-x'] },
        'src/e.ts': { endpoints: [], crons: [] },
      },
    });

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    // 2 symbols, 3 callers, 2 endpoints (fn1 gets GET /a + POST /b), 1 cron (fn1)
    expect(result.blast!.summary).toBe(
      '2 symbols changed · 3 callers · 2 endpoints · 1 cron reachable',
    );
  });
});

describe('BlastService.getBlast — available:false when empty', () => {
  it('sets available:false and blast:null when no symbols or callers', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };

    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);

    expect(result.available).toBe(false);
    expect(result.blast).toBeNull();
  });

  it('sets available:false when changed files are empty', async () => {
    const svc = buildService({ files: [] });
    const result = await svc.getBlast(WS_ID, PR_ID);

    expect(result.available).toBe(false);
    expect(result.blast).toBeNull();
  });
});

describe('BlastService.getBlast — result parses with BlastResponse schema', () => {
  it('parses result with BlastResponse when available:true', async () => {
    const svc = buildService({});
    const result = await svc.getBlast(WS_ID, PR_ID);
    expect(() => BlastResponse.parse(result)).not.toThrow();
  });

  it('parses result with BlastResponse when available:false', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const svc = buildService({ blastResult });
    const result = await svc.getBlast(WS_ID, PR_ID);
    expect(() => BlastResponse.parse(result)).not.toThrow();
  });

  it('includes index state in the result', async () => {
    const indexState = makeIndexState({
      status: 'partial',
      degraded: true,
      degradedReason: 'index_partial',
    });
    const svc = buildService({ indexState });
    const result = await svc.getBlast(WS_ID, PR_ID);

    expect(result.index.status).toBe('partial');
    expect(result.index.degraded).toBe(true);
    expect(result.index.reason).toBe('index_partial');
  });

  it('includes link when repo basics are available', async () => {
    const svc = buildService({ repoBasics: { owner: 'myOrg', name: 'myRepo' } });
    const result = await svc.getBlast(WS_ID, PR_ID);

    expect(result.link).toEqual({
      owner: 'myOrg',
      repo: 'myRepo',
      head_sha: PR_ROW.headSha,
    });
  });

  it('sets link:null when repo basics are missing', async () => {
    const svc = buildService({ repoBasics: null });
    const result = await svc.getBlast(WS_ID, PR_ID);
    expect(result.link).toBeNull();
  });
});
