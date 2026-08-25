import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import {
  distinctReverseFiles,
  buildFileImpact,
  buildPriorPrs,
  buildBlastResponse,
} from '../src/modules/blast/helpers.js';
import type {
  ChangedFileFactsRow,
  OtherPrMetaRow,
  PrFileOverlapRow,
  ReverseEdgeRow,
} from '../src/modules/blast/types.js';
import type { BlastResult, IndexState } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic coverage for T5's PURE walk/merge helpers (plan 06-blast-radius.md
 * T5) — `distinctReverseFiles`, `buildFileImpact` and `buildPriorPrs` are
 * exercised directly with hand-built rows, exactly as `repository.ts`'s two
 * bounded `getReverseEdges` calls (and its `pull_requests`/`pr_files` reads)
 * WOULD have returned them against a real Postgres — no DB, no mock `Db`.
 * `onion-architecture` §5 Tests: R2-grade pure functions get the hermetic
 * `.test.ts` lane, never `.it.test.ts`.
 */

function baseIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date('2026-08-24T00:00:00Z'),
    ...overrides,
  };
}

function baseBlastResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    degraded: false,
    ...overrides,
  };
}

describe('distinctReverseFiles — REQ-9 one level of the reverse-import walk, pure', () => {
  it('dedups fromFile across multiple edges and excludes files already reached', () => {
    const edges: ReverseEdgeRow[] = [
      { fromFile: 'src/b.ts', toFile: 'src/a.ts' },
      { fromFile: 'src/b.ts', toFile: 'src/a2.ts' }, // same importer, two changed files -> deduped
      { fromFile: 'src/a.ts', toFile: 'src/a2.ts' }, // importer IS a changed file -> excluded
    ];
    const out = distinctReverseFiles(edges, new Set(['src/a.ts', 'src/a2.ts']));
    expect(out).toEqual(['src/b.ts']);
  });

  it('returns [] for no edges', () => {
    expect(distinctReverseFiles([], new Set())).toEqual([]);
  });
});

describe('the depth<=2 bound (REQ-9): a chain A<-B<-C<-D never reaches D', () => {
  // Forward imports: D imports C, C imports B, B imports A. Reverse-walk
  // seeded at A (the changed file) must find B (depth 1) then C (depth 2) —
  // D would only be reachable at depth 3, which this module NEVER queries
  // (service.ts calls `repository.ts::getReverseEdges` exactly twice).
  const changed = ['src/a.ts'];
  // What repository.getReverseEdges(repoId, ['src/a.ts']) would return:
  const level1RawEdges: ReverseEdgeRow[] = [{ fromFile: 'src/b.ts', toFile: 'src/a.ts' }];
  // What repository.getReverseEdges(repoId, ['src/b.ts']) would return:
  const level2RawEdges: ReverseEdgeRow[] = [{ fromFile: 'src/c.ts', toFile: 'src/b.ts' }];

  it('level 1 = [B], level 2 = [C], D never appears anywhere', () => {
    const changedSet = new Set(changed);
    const level1Files = distinctReverseFiles(level1RawEdges, changedSet);
    expect(level1Files).toEqual(['src/b.ts']);

    const level2Files = distinctReverseFiles(
      level2RawEdges,
      new Set([...changedSet, ...level1Files]),
    );
    expect(level2Files).toEqual(['src/c.ts']);

    // D is only reachable by querying importers of C — a THIRD level this
    // module structurally never issues. Assert it directly: neither list
    // (nor anything derived from them) contains it.
    expect(level1Files).not.toContain('src/d.ts');
    expect(level2Files).not.toContain('src/d.ts');

    const facts = new Map<string, ChangedFileFactsRow>();
    const fileImpact = buildFileImpact(level1Files, level2Files, facts);
    expect(fileImpact.map((f) => f.file)).toEqual(['src/b.ts', 'src/c.ts']);
    expect(fileImpact.every((f) => f.file !== 'src/d.ts')).toBe(true);
    // Changed files themselves never appear in file_impact.
    expect(fileImpact.every((f) => f.file !== 'src/a.ts')).toBe(true);
  });

  it('a file reached at depth 1 is never re-reported at depth 2 (dedup across levels)', () => {
    // B is both a direct importer of A AND (pathologically) an edge target
    // at level 2 — the exclude set passed to the level-2 call must already
    // contain B, so it cannot resurface.
    const level1Files = distinctReverseFiles(level1RawEdges, new Set(changed));
    const level2RawEdgesWithDup: ReverseEdgeRow[] = [
      { fromFile: 'src/c.ts', toFile: 'src/b.ts' },
      { fromFile: 'src/b.ts', toFile: 'src/b.ts' }, // degenerate self/dup edge
    ];
    const level2Files = distinctReverseFiles(
      level2RawEdgesWithDup,
      new Set([...changed, ...level1Files]),
    );
    expect(level2Files).toEqual(['src/c.ts']);
    expect(level2Files).not.toContain('src/b.ts');
  });
});

describe('buildFileImpact — REQ-9/A1: per FILE, never per (file, symbol)', () => {
  it('attaches depth and file_facts chips, and carries no viaSymbol-style field', () => {
    const facts = new Map<string, ChangedFileFactsRow>([
      ['src/b.ts', { filePath: 'src/b.ts', endpoints: ['GET /b'], crons: [] }],
      ['src/c.ts', { filePath: 'src/c.ts', endpoints: [], crons: ['0 * * * *'] }],
    ]);
    const out = buildFileImpact(['src/b.ts'], ['src/c.ts'], facts);
    expect(out).toEqual([
      { file: 'src/b.ts', depth: 1, chips: [{ label: 'GET /b', kind: 'endpoint', file: 'src/b.ts' }] },
      { file: 'src/c.ts', depth: 2, chips: [{ label: '0 * * * *', kind: 'cron', file: 'src/c.ts' }] },
    ]);
    for (const entry of out) {
      expect(Object.keys(entry).sort()).toEqual(['chips', 'depth', 'file']);
    }
  });

  it('a file with no file_facts row gets an empty chips array, not a dropped entry', () => {
    const out = buildFileImpact(['src/nofacts.ts'], [], new Map());
    expect(out).toEqual([{ file: 'src/nofacts.ts', depth: 1, chips: [] }]);
  });
});

describe('buildPriorPrs — REQ-10, pure grouping + ordering + capping', () => {
  const otherPrs: OtherPrMetaRow[] = [
    { id: 'pr-a', number: 10, title: 'A', status: 'needs_review', updatedAt: '2026-08-20T00:00:00.000Z' },
    { id: 'pr-b', number: 20, title: 'B', status: 'approved', updatedAt: '2026-08-22T00:00:00.000Z' },
    // Same updated_at as pr-d — order must fall back to number desc.
    { id: 'pr-c', number: 5, title: 'C', status: 'needs_review', updatedAt: '2026-08-23T00:00:00.000Z' },
    { id: 'pr-d', number: 30, title: 'D', status: 'needs_review', updatedAt: '2026-08-23T00:00:00.000Z' },
    // No overlapping pr_files rows below -> must be dropped entirely.
    { id: 'pr-e', number: 40, title: 'E', status: 'needs_review', updatedAt: '2026-08-24T00:00:00.000Z' },
  ];

  it('groups overlap rows by PR, computes overlap_count from the set, and orders updated_at desc then number desc', () => {
    const overlap: PrFileOverlapRow[] = [
      { prId: 'pr-a', path: 'src/a.ts' },
      { prId: 'pr-b', path: 'src/a.ts' },
      { prId: 'pr-b', path: 'src/b.ts' },
      { prId: 'pr-b', path: 'src/b.ts' }, // duplicate path row -> must not inflate overlap_count
      { prId: 'pr-c', path: 'src/a.ts' },
      { prId: 'pr-d', path: 'src/a.ts' },
      { prId: 'pr-d', path: 'src/b.ts' },
    ];
    const out = buildPriorPrs(otherPrs, overlap);

    // pr-e had zero overlap rows -> dropped, not an honest empty entry.
    expect(out.find((r) => r.number === 40)).toBeUndefined();

    // updated_at DESC first: pr-d/pr-c (2026-08-23) before pr-b (08-22) before pr-a (08-20).
    // pr-d vs pr-c tie on updated_at -> number DESC breaks it: 30 before 5.
    expect(out.map((r) => r.number)).toEqual([30, 5, 20, 10]);

    const prD = out.find((r) => r.number === 30);
    expect(prD?.overlap_count).toBe(2);
    expect(prD?.overlapping_files.sort()).toEqual(['src/a.ts', 'src/b.ts']);

    const prB = out.find((r) => r.number === 20);
    expect(prB?.overlap_count).toBe(2); // duplicate path row deduped by the Set
  });

  it('caps at MAX_PRIOR_PRS', () => {
    const many: OtherPrMetaRow[] = Array.from({ length: 15 }, (_, i) => ({
      id: `pr-${i}`,
      number: i,
      title: `PR ${i}`,
      status: 'needs_review',
      updatedAt: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const overlap: PrFileOverlapRow[] = many.map((p) => ({ prId: p.id, path: 'src/a.ts' }));
    const out = buildPriorPrs(many, overlap);
    expect(out.length).toBeLessThanOrEqual(10);
    // Newest updated_at first (highest index).
    expect(out[0].number).toBe(14);
  });

  it('a PR with a null updated_at sorts as older than any dated PR', () => {
    const withNull: OtherPrMetaRow[] = [
      { id: 'pr-null', number: 99, title: 'Null', status: 'needs_review', updatedAt: null },
      { id: 'pr-dated', number: 1, title: 'Dated', status: 'needs_review', updatedAt: '2026-08-01T00:00:00.000Z' },
    ];
    const overlap: PrFileOverlapRow[] = [
      { prId: 'pr-null', path: 'src/a.ts' },
      { prId: 'pr-dated', path: 'src/a.ts' },
    ];
    const out = buildPriorPrs(withNull, overlap);
    expect(out.map((r) => r.number)).toEqual([1, 99]);
  });
});

describe('buildBlastResponse — totals union-dedups (kind, label) across symbols[].chips and file_impact[].chips', () => {
  it('the SAME endpoint reached via a symbol chip and a file_impact chip on a DIFFERENT file counts once', () => {
    const result = buildBlastResponse({
      blastResult: baseBlastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'bar', viaSymbol: 'foo', line: 1, rank: 1 }],
        factsByFile: { 'src/caller.ts': { endpoints: ['GET /shared'], crons: [] } },
      }),
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: ['src/a.ts'],
      changedFileFacts: [],
      fileImpact: [
        { file: 'src/other.ts', depth: 1, chips: [{ label: 'GET /shared', kind: 'endpoint', file: 'src/other.ts' }] },
        { file: 'src/cronfile.ts', depth: 2, chips: [{ label: '0 * * * *', kind: 'cron', file: 'src/cronfile.ts' }] },
      ],
      importsAvailable: true,
    });
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();
    // 1 distinct endpoint label ("GET /shared", counted once despite appearing
    // via a symbol chip AND a file_impact chip on a different file) + 1 cron.
    expect(result.totals.endpoints).toBe(1);
    expect(result.totals.crons).toBe(1);
    // A1: file_impact is carried on the response but never merged into symbols[].chips.
    expect(result.symbols[0].chips).toEqual([{ label: 'GET /shared', kind: 'endpoint', file: 'src/caller.ts' }]);
    expect(result.file_impact).toHaveLength(2);
    expect(result.coverage.imports_available).toBe(true);
  });

  it('defaults: omitting fileImpact/priorPrs/*_available keeps the T2 shape (empty arrays, false coverage)', () => {
    const result = buildBlastResponse({
      blastResult: baseBlastResult(),
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: [],
      changedFileFacts: [],
    });
    expect(result.file_impact).toEqual([]);
    expect(result.prior_prs).toEqual([]);
    expect(result.coverage.imports_available).toBe(false);
    expect(result.coverage.prior_prs_available).toBe(false);
  });
});
