import { describe, it, expect } from 'vitest';
import { BlastRadiusResponse } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import type { RepoIntel, BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { BlastService, type BlastServiceDeps } from '../src/modules/blast/service.js';
import { deriveStatus, buildBlastResponse } from '../src/modules/blast/helpers.js';

/**
 * Hermetic coverage for `blast/` (plan 06-blast-radius.md T2) — `service.ts`,
 * `repository.ts` and `helpers.ts` exercised together through a `Deps`
 * OBJECT LITERAL, per `onion-architecture` §5 Tests / server/INSIGHTS.md
 * 2026-08-15. No `as never`, no private-field write — `repoIntel` fully
 * implements `RepoIntel` (a real object, not a cast); `db` needs exactly ONE
 * targeted `as unknown as Db` at its own construction, because `Db` is
 * `PostgresJsDatabase<typeof schema>` — too large to satisfy structurally
 * with a literal — but nothing else in this file bypasses the type system.
 * No Docker, no Postgres: this is the `.test.ts` lane, not `.it.test.ts`
 * (server/INSIGHTS.md 2026-08-09) — the DB-backed counterpart is T7's
 * `blast.it.test.ts`.
 */

type Row = Record<string, unknown>;

function fakeDb(rowsByTable: Map<unknown, Row[]>): Db {
  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => ({
        where: async () => rowsByTable.get(table) ?? [],
      }),
    }),
  };
  return db as unknown as Db;
}

function fakeRepoIntel(overrides: Partial<RepoIntel>): RepoIntel {
  const notStubbed =
    (name: string) =>
    (..._args: unknown[]) => {
      throw new Error(`fakeRepoIntel.${name} not stubbed for this test`);
    };
  return {
    indexRepo: notStubbed('indexRepo'),
    refreshIndex: notStubbed('refreshIndex'),
    getIndexState: notStubbed('getIndexState'),
    getBlastRadius: notStubbed('getBlastRadius'),
    getRepoMap: notStubbed('getRepoMap'),
    getFileRank: notStubbed('getFileRank'),
    getSymbolsInFiles: notStubbed('getSymbolsInFiles'),
    getCallerSignatures: notStubbed('getCallerSignatures'),
    getUnresolvedReferences: notStubbed('getUnresolvedReferences'),
    getConventionSamples: notStubbed('getConventionSamples'),
    getAllSymbolNames: notStubbed('getAllSymbolNames'),
    getTopFilesByRank: notStubbed('getTopFilesByRank'),
    getCriticalPaths: notStubbed('getCriticalPaths'),
    ...overrides,
  };
}

/**
 * D3: `BlastServiceDeps.llm` is required, but none of this file's fixtures
 * pass a `narrationModel` third arg to `getBlastRadius`, so `deps.llm` is
 * never invoked here — a throwing stub keeps that assumption honest instead
 * of silently returning `undefined`.
 */
function throwingLlm(): BlastServiceDeps['llm'] {
  return () => {
    throw new Error('deps.llm must NOT be invoked — no narrationModel passed in this file');
  };
}

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

describe('BlastService.getBlastRadius — Deps object literal, no cast, no private-field write', () => {
  it('undefined PR (workspace mismatch or unknown id) resolves undefined — route maps this to 404', async () => {
    const db = fakeDb(new Map());
    const service = new BlastService({
      db,
      repoIntel: fakeRepoIntel({}),
      llm: throwingLlm(),
    });
    await expect(service.getBlastRadius('ws-1', 'missing-pr')).resolves.toBeUndefined();
  });

  it('ok path — REQ-2/REQ-3/REQ-4/REQ-5(G1): symbols from repoIntel, callers capped+sorted+file-excluded, changed files from pr_files, direct-file chips merged', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        { file: 'src/caller.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 },
        // same file as the declaration — REQ-3 excludes it even though repoIntel already should.
        { file: 'src/a.ts', symbol: 'self', viaSymbol: 'foo', line: 2, rank: 99 },
      ],
      impactedEndpoints: ['GET /foo'],
      factsByFile: { 'src/caller.ts': { endpoints: ['GET /foo'], crons: [] } },
      degraded: false,
    };
    const db = fakeDb(
      new Map<unknown, Row[]>([
        [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
        [
          schema.prFiles,
          [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        ],
        [
          schema.fileFacts,
          // REQ-5 / gap G1 — endpoint + cron declared DIRECTLY in the changed file.
          [{ filePath: 'src/a.ts', endpoints: ['POST /bar'], crons: ['0 * * * *'] }],
        ],
      ]),
    );
    const service = new BlastService({
      db,
      repoIntel: fakeRepoIntel({
        getBlastRadius: async () => blastResult,
        getIndexState: async () => baseIndexState({ status: 'full' }),
      }),
      llm: throwingLlm(),
    });

    const result = await service.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    // Round-trips the actual wire schema — not just the TS type — so a
    // shape drift fails here, not the first time Fastify serializes it.
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();

    expect(result.status).toBe('ok');
    expect(result.status_reason).toBe('');
    expect(result.changed_file_count).toBe(2);

    expect(result.symbols).toHaveLength(1);
    const symbol = result.symbols[0];
    expect(symbol.name).toBe('foo');
    // REQ-3: excludes the declaring file's own "caller", keeps the real one.
    expect(symbol.callers).toEqual([{ file: 'src/caller.ts', symbol: 'bar', line: 10, rank: 5 }]);
    expect(symbol.caller_count).toBe(1);

    // Chips merge BOTH the direct changed-file facts (G1) and the caller-file
    // facts repoIntel already attributes (`factsByFile`).
    expect(symbol.chips).toEqual(
      expect.arrayContaining([
        { label: 'POST /bar', kind: 'endpoint', file: 'src/a.ts' },
        { label: '0 * * * *', kind: 'cron', file: 'src/a.ts' },
        { label: 'GET /foo', kind: 'endpoint', file: 'src/caller.ts' },
      ]),
    );
    expect(symbol.chips).toHaveLength(3);

    expect(result.totals).toEqual({ symbols: 1, callers: 1, endpoints: 2, crons: 1 });
    expect(result.coverage.callers_available).toBe(true);
    expect(result.coverage.endpoints_available).toBe(true);
    expect(result.coverage.crons_available).toBe(true);
    expect(result.coverage.imports_available).toBe(false);
    expect(result.coverage.prior_prs_available).toBe(false);

    // T5 fills these — T2 always emits them empty, never as a stub with wrong availability.
    expect(result.file_impact).toEqual([]);
    expect(result.prior_prs).toEqual([]);
    // REQ-20 — no LLM resolved in this module.
    expect(result.narrative).toBeNull();
  });

  it('caps callers at 20 and orders by rank desc (REQ-3)', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      file: `src/caller-${i}.ts`,
      symbol: 'c',
      viaSymbol: 'foo',
      line: 1,
      rank: i, // ascending input order — output must be rank-desc, capped
    }));
    const blastResult: BlastResult = {
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: many,
      impactedEndpoints: [],
      degraded: false,
    };
    const db = fakeDb(
      new Map<unknown, Row[]>([
        [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
        [schema.prFiles, [{ path: 'src/a.ts' }]],
        [schema.fileFacts, []],
      ]),
    );
    const service = new BlastService({
      db,
      repoIntel: fakeRepoIntel({
        getBlastRadius: async () => blastResult,
        getIndexState: async () => baseIndexState({ status: 'full' }),
      }),
      llm: throwingLlm(),
    });
    const result = await service.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    expect(result.symbols[0].caller_count).toBe(25); // pre-cap
    expect(result.symbols[0].callers).toHaveLength(20); // capped
    expect(result.symbols[0].callers[0].rank).toBe(24); // desc order
    expect(result.symbols[0].callers[19].rank).toBe(5);
  });

  it('degraded path — REQ-6/REQ-7 (gap G2): status=degraded, crons_available=false, status_reason names crons — never a silent 0', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    const db = fakeDb(
      new Map<unknown, Row[]>([
        [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
        [schema.prFiles, [{ path: 'src/a.ts' }]],
        [schema.fileFacts, []],
      ]),
    );
    const service = new BlastService({
      db,
      repoIntel: fakeRepoIntel({
        getBlastRadius: async () => blastResult,
        getIndexState: async () => baseIndexState({ status: 'degraded', degraded: true, degradedReason: 'no_data' }),
      }),
      llm: throwingLlm(),
    });
    const result = await service.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    expect(() => BlastRadiusResponse.parse(result)).not.toThrow();

    expect(result.status).toBe('degraded');
    expect(result.status_reason.length).toBeGreaterThan(0);
    expect(result.status_reason.toLowerCase()).toContain('cron');
    expect(result.coverage.crons_available).toBe(false);
    expect(result.totals.crons).toBe(0); // genuinely nothing computed here, not hidden by [] alone —
    // the point of the test is that `crons_available` (not the array) is what says "unknown".
    // D1 (REQ-8): `reason: 'no_data'` means NOTHING was attempted — neither the
    // persistent path nor the ripgrep fallback ran — so `callers`/`endpoints`
    // must report `false` here too, not just crons. `callers: []` next to
    // `callers_available: true` would assert "zero callers" about a fact the
    // engine never had.
    expect(result.coverage.callers_available).toBe(false);
    expect(result.coverage.endpoints_available).toBe(false);
  });

  it('partial index — REQ-6: status=partial, non-empty reason, crons still available', async () => {
    const blastResult: BlastResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    };
    const db = fakeDb(
      new Map<unknown, Row[]>([
        [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
        [schema.prFiles, []],
        [schema.fileFacts, []],
      ]),
    );
    const service = new BlastService({
      db,
      repoIntel: fakeRepoIntel({
        getBlastRadius: async () => blastResult,
        getIndexState: async () => baseIndexState({ status: 'partial' }),
      }),
      llm: throwingLlm(),
    });
    const result = await service.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    expect(result.status).toBe('partial');
    expect(result.status_reason.length).toBeGreaterThan(0);
    expect(result.coverage.crons_available).toBe(true);
  });
});

describe('deriveStatus — the REQ-6/REQ-7 table directly', () => {
  it('full + not degraded => ok, empty reason', () => {
    const r = deriveStatus(baseIndexState({ status: 'full' }), {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    });
    expect(r).toEqual({ status: 'ok', statusReason: '' });
  });

  it('partial + not degraded => partial, non-empty reason', () => {
    const r = deriveStatus(baseIndexState({ status: 'partial' }), {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: false,
    });
    expect(r.status).toBe('partial');
    expect(r.statusReason.length).toBeGreaterThan(0);
  });

  it.each(['degraded', 'failed'] as const)(
    'indexState.status=%s (with degraded=true) => degraded, non-empty reason',
    (status) => {
      const r = deriveStatus(baseIndexState({ status }), {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
      });
      expect(r.status).toBe('degraded');
      expect(r.statusReason.length).toBeGreaterThan(0);
    },
  );

  it('BlastResult.degraded=true overrides an otherwise-full index state => degraded', () => {
    const r = deriveStatus(baseIndexState({ status: 'full' }), {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_failed',
    });
    expect(r.status).toBe('degraded');
  });
});

describe('buildBlastResponse — no array substitutes for "unknown" (REQ-8)', () => {
  it('an empty symbols[] with status=ok is a genuine empty, not an unknown', () => {
    const result = buildBlastResponse({
      blastResult: { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: false },
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: [],
      changedFileFacts: [],
    });
    expect(result.status).toBe('ok');
    expect(result.symbols).toEqual([]);
    expect(result.coverage.callers_available).toBe(true);
    expect(result.coverage.endpoints_available).toBe(true);
    expect(result.coverage.crons_available).toBe(true);
  });

  it('reason "no_data" with an EMPTY result (three early-exit sites) reports unavailable', () => {
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
      },
      indexState: baseIndexState({ status: 'degraded', degraded: true, degradedReason: 'no_data' }),
      changedFiles: ['src/a.ts'],
      changedFileFacts: [],
    });
    expect(result.coverage.callers_available).toBe(false);
    expect(result.coverage.endpoints_available).toBe(false);
  });

  it('reason "no_data" but the ripgrep fallback SUCCEEDED (non-empty callers/symbols) still reports available — repo-intel/service.ts:298-304', () => {
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [
          { file: 'src/caller.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 0 },
        ],
        impactedEndpoints: ['GET /foo'],
        // The fallback's success return carries `reason: 'no_data'` too —
        // this is the shape `service.ts:298-304` actually emits: degraded
        // AND `reason: 'no_data'` AND non-empty data, all at once.
        degraded: true,
        reason: 'no_data',
      },
      indexState: baseIndexState({ status: 'degraded', degraded: true, degradedReason: 'no_data' }),
      changedFiles: ['src/a.ts'],
      changedFileFacts: [],
    });
    expect(result.coverage.callers_available).toBe(true);
    expect(result.coverage.endpoints_available).toBe(true);
  });
});

describe('buildBlastResponse — D2: callers attributed by (name, declFile), not name alone', () => {
  it('two changed symbols sharing a NAME in different files each get only their OWN caller', () => {
    // The exact repro from the plan: `compileSafeRegex` declared in two
    // different files, with distinct callers. Before the fix (matching by
    // `viaSymbol` name only), BOTH symbols would show the SAME caller row.
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [
          { file: 'src/modules/conventions/helpers.ts', name: 'compileSafeRegex', kind: 'function' },
          { file: 'src/platform/pattern-safety.ts', name: 'compileSafeRegex', kind: 'function' },
        ],
        callers: [
          {
            file: 'src/mocks.ts',
            symbol: 'buildMock',
            viaSymbol: 'compileSafeRegex',
            line: 312,
            rank: 5,
            declFile: 'src/modules/conventions/helpers.ts',
          },
        ],
        impactedEndpoints: [],
        degraded: false,
      },
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: [
        'src/modules/conventions/helpers.ts',
        'src/platform/pattern-safety.ts',
      ],
      changedFileFacts: [],
    });

    const conventions = result.symbols.find((s) => s.file === 'src/modules/conventions/helpers.ts');
    const patternSafety = result.symbols.find((s) => s.file === 'src/platform/pattern-safety.ts');
    if (!conventions || !patternSafety) throw new Error('expected both symbols in the response');

    // `mocks.ts:312` calls exactly ONE of the two same-named symbols — only
    // the correctly-attributed one shows the caller.
    expect(conventions.callers).toHaveLength(1);
    expect(conventions.callers[0]).toEqual({
      file: 'src/mocks.ts',
      symbol: 'buildMock',
      line: 312,
      rank: 5,
    });
    expect(conventions.caller_count).toBe(1);

    // The OTHER same-named symbol must NOT show the same caller row.
    expect(patternSafety.callers).toEqual([]);
    expect(patternSafety.caller_count).toBe(0);
  });

  it('a BlastCallerRow with no declFile (pre-fix fixture) keeps the OLD name-only match — backward compatible', () => {
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [
          // no `declFile` — simulates a hand-built fixture written before D2's fix.
          { file: 'src/caller.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 },
        ],
        impactedEndpoints: [],
        degraded: false,
      },
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: ['src/a.ts'],
      changedFileFacts: [],
    });
    expect(result.symbols[0].callers).toHaveLength(1);
    expect(result.symbols[0].caller_count).toBe(1);
  });
});

describe('buildBlastResponse — symbols[] ordering: caller_count desc, chips.length desc, name asc', () => {
  it('sorts uncapped symbols[] by usefulness — REQ-2 stays uncapped, only the ORDER changes', () => {
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [
          // Deliberately out of order — the sort must reorder these.
          { file: 'src/zebra.ts', name: 'zebra', kind: 'function' }, // 0 callers, 0 chips
          { file: 'src/alpha.ts', name: 'alpha', kind: 'function' }, // 1 caller, 0 chips
          { file: 'src/gamma.ts', name: 'gamma', kind: 'function' }, // 2 callers, 1 chip
          { file: 'src/beta.ts', name: 'beta', kind: 'function' }, // 2 callers, 0 chips
        ],
        callers: [
          {
            file: 'src/c1.ts',
            symbol: 'c1',
            viaSymbol: 'alpha',
            line: 1,
            rank: 1,
            declFile: 'src/alpha.ts',
          },
          {
            file: 'src/c2.ts',
            symbol: 'c2',
            viaSymbol: 'gamma',
            line: 1,
            rank: 1,
            declFile: 'src/gamma.ts',
          },
          {
            file: 'src/c3.ts',
            symbol: 'c3',
            viaSymbol: 'gamma',
            line: 2,
            rank: 1,
            declFile: 'src/gamma.ts',
          },
          {
            file: 'src/c4.ts',
            symbol: 'c4',
            viaSymbol: 'beta',
            line: 1,
            rank: 1,
            declFile: 'src/beta.ts',
          },
          {
            file: 'src/c5.ts',
            symbol: 'c5',
            viaSymbol: 'beta',
            line: 2,
            rank: 1,
            declFile: 'src/beta.ts',
          },
        ],
        impactedEndpoints: [],
        factsByFile: { 'src/c2.ts': { endpoints: ['GET /gamma'], crons: [] } },
        degraded: false,
      },
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: ['src/zebra.ts', 'src/alpha.ts', 'src/gamma.ts', 'src/beta.ts'],
      changedFileFacts: [],
    });

    // REQ-2: still every symbol, no cap.
    expect(result.symbols).toHaveLength(4);
    // gamma (2 callers, 1 chip) beats beta (2 callers, 0 chips) on the
    // chips.length tiebreak; alpha (1 caller) beats zebra (0 callers).
    expect(result.symbols.map((s) => s.name)).toEqual(['gamma', 'beta', 'alpha', 'zebra']);
  });

  it('name asc breaks a full tie (same caller_count, same chips.length)', () => {
    const result = buildBlastResponse({
      blastResult: {
        changedSymbols: [
          { file: 'src/z.ts', name: 'zzz', kind: 'function' },
          { file: 'src/a.ts', name: 'aaa', kind: 'function' },
        ],
        callers: [],
        impactedEndpoints: [],
        degraded: false,
      },
      indexState: baseIndexState({ status: 'full' }),
      changedFiles: ['src/z.ts', 'src/a.ts'],
      changedFileFacts: [],
    });
    expect(result.symbols.map((s) => s.name)).toEqual(['aaa', 'zzz']);
  });
});
