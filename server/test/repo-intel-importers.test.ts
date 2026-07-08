/**
 * Unit tests for `RepoIntelService.getImporters` — reverse import-graph BFS.
 *
 * Hermetic: no Postgres, no Docker, no clone. The service's `repo`
 * (RepoIntelRepository) is patched with a stub so we exercise the BFS logic
 * and gate conditions in isolation.
 *
 * Pattern mirrors repo-intel-facade-degraded.test.ts: build the service with a
 * minimal container stub, then replace `(svc as any).repo` with a stub that
 * controls which edges are returned per query.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexerEdgeRow } from '../src/modules/repo-intel/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a RepoIntelService with a minimal container and a stubbed repository.
 *
 * `edgeMap` drives `getReverseEdges`: given a list of `toFiles`, the stub
 * returns every edge whose `toFile` is in that list. This lets tests control
 * the graph without a real DB.
 */
function buildService(opts: {
  flagEnabled: boolean;
  edges: IndexerEdgeRow[];
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flagEnabled },
    db: {} as never,
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;

  const svc = new RepoIntelService(container);

  // Patch the repository with a stub that answers getReverseEdges from the
  // provided edge list. Other repo methods are no-ops (not exercised by these
  // tests). `tryGetIndexState` returns null so getEdges-based methods degrade.
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => null,
    tryGetIndexState: async () => null,
    getEdges: async () => [],
    getReverseEdges: async (_repoId: string, toFiles: string[]) => {
      const toSet = new Set(toFiles);
      return opts.edges.filter((e) => toSet.has(e.toFile));
    },
  };

  return svc;
}

// ---------------------------------------------------------------------------
// Graph fixture:
//   A.ts → B.ts → C.ts
//   D.ts → B.ts
//
// forward edges (importer → imported):
//   A imports B, B imports C, D imports B
//
// Reverse (who imports X?):
//   B is imported by A, D
//   C is imported by B
// ---------------------------------------------------------------------------
const EDGES: IndexerEdgeRow[] = [
  { fromFile: 'A.ts', toFile: 'B.ts' },
  { fromFile: 'B.ts', toFile: 'C.ts' },
  { fromFile: 'D.ts', toFile: 'B.ts' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getImporters — gate conditions', () => {
  it('returns [] when repoIntelEnabled=false', async () => {
    const svc = buildService({ flagEnabled: false, edges: EDGES });
    await expect(svc.getImporters('repo1', ['B.ts'])).resolves.toEqual([]);
  });

  it('returns [] for empty input files', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    await expect(svc.getImporters('repo1', [])).resolves.toEqual([]);
  });

  it('returns [] when depth <= 0', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    await expect(svc.getImporters('repo1', ['B.ts'], 0)).resolves.toEqual([]);
  });

  it('returns [] when there are no edges at all', async () => {
    const svc = buildService({ flagEnabled: true, edges: [] });
    await expect(svc.getImporters('repo1', ['B.ts'])).resolves.toEqual([]);
  });
});

describe('getImporters — depth-1 direct importers only', () => {
  it('returns the single direct importer at depth=1', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    // C is imported by B only.
    const result = await svc.getImporters('repo1', ['C.ts'], 1);
    expect(result).toEqual(['B.ts']);
  });

  it('returns multiple direct importers at depth=1', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    // B is imported by A and D.
    const result = await svc.getImporters('repo1', ['B.ts'], 1);
    expect(result).toHaveLength(2);
    expect(result).toContain('A.ts');
    expect(result).toContain('D.ts');
  });

  it('returns [] when no file imports the input at depth=1', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    // A.ts is not imported by anyone.
    const result = await svc.getImporters('repo1', ['A.ts'], 1);
    expect(result).toEqual([]);
  });
});

describe('getImporters — depth-2 transitive reachability', () => {
  it('reaches depth-2 importers when depth=2 (default)', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    // C's direct importer is B; B's direct importers are A, D.
    // At depth=2, starting from C, we should get B, A, D.
    const result = await svc.getImporters('repo1', ['C.ts']);
    expect(result).toHaveLength(3);
    expect(result).toContain('B.ts');
    expect(result).toContain('A.ts');
    expect(result).toContain('D.ts');
  });

  it('does not include the input files in the output', async () => {
    const svc = buildService({ flagEnabled: true, edges: EDGES });
    const result = await svc.getImporters('repo1', ['C.ts']);
    expect(result).not.toContain('C.ts');
  });

  it('stops at depth=2 even if deeper importers exist', async () => {
    // Chain: X → A → B → C (depth > 2 from C)
    const deepEdges: IndexerEdgeRow[] = [
      ...EDGES,
      { fromFile: 'X.ts', toFile: 'A.ts' }, // depth-3 from C
    ];
    const svc = buildService({ flagEnabled: true, edges: deepEdges });
    // Starting from C at depth=2 we reach B (d=1) then A,D (d=2). X is d=3.
    const result = await svc.getImporters('repo1', ['C.ts'], 2);
    expect(result).toContain('B.ts');
    expect(result).toContain('A.ts');
    expect(result).toContain('D.ts');
    expect(result).not.toContain('X.ts');
  });
});

describe('getImporters — cycle safety and deduplication', () => {
  it('terminates on a cycle (A → B → A)', async () => {
    const cycleEdges: IndexerEdgeRow[] = [
      { fromFile: 'A.ts', toFile: 'B.ts' }, // A imports B
      { fromFile: 'B.ts', toFile: 'A.ts' }, // B imports A (cycle)
    ];
    const svc = buildService({ flagEnabled: true, edges: cycleEdges });
    // Starting from B, depth=2: A imports B → A is d=1 importer.
    // Then B imports A, but B is in the input set (visited) → stops.
    const result = await svc.getImporters('repo1', ['B.ts'], 2);
    expect(result).toEqual(['A.ts']);
    expect(result).not.toContain('B.ts');
  });

  it('deduplicates when multiple input files share an importer', async () => {
    // X imports both B and C. Starting from [B, C] at depth=1, X should appear
    // exactly once even though it reaches both inputs.
    const sharedEdges: IndexerEdgeRow[] = [
      { fromFile: 'X.ts', toFile: 'B.ts' },
      { fromFile: 'X.ts', toFile: 'C.ts' },
    ];
    const svc = buildService({ flagEnabled: true, edges: sharedEdges });
    const result = await svc.getImporters('repo1', ['B.ts', 'C.ts'], 1);
    expect(result).toEqual(['X.ts']);
  });

  it('deduplicates when a file is reachable via multiple paths', async () => {
    // A imports B and C; both B and C import D.
    // Starting from D at depth=2: B,C (d=1), A (d=2 via B AND via C → only once).
    const multiPathEdges: IndexerEdgeRow[] = [
      { fromFile: 'A.ts', toFile: 'B.ts' },
      { fromFile: 'A.ts', toFile: 'C.ts' },
      { fromFile: 'B.ts', toFile: 'D.ts' },
      { fromFile: 'C.ts', toFile: 'D.ts' },
    ];
    const svc = buildService({ flagEnabled: true, edges: multiPathEdges });
    const result = await svc.getImporters('repo1', ['D.ts'], 2);
    expect(result).toContain('B.ts');
    expect(result).toContain('C.ts');
    expect(result).toContain('A.ts');
    // A must appear exactly once.
    expect(result.filter((f) => f === 'A.ts')).toHaveLength(1);
  });
});
