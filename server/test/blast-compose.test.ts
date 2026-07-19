import { describe, it, expect } from 'vitest';
import { mapFacadeBlast } from '../src/modules/blast/service.js';
import { summarizeBlast, callerName } from '../src/modules/blast/helpers.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/** A BlastResult fixture (facade output) with one changed symbol + 2 callers. */
function fb(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [{ file: 'src/mw/ratelimit.ts', name: 'rateLimit', kind: 'function' }],
    callers: [
      { file: 'src/api/public.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 50 },
      { file: 'src/server.ts', symbol: 'boot', viaSymbol: 'rateLimit', line: 88, rank: 90 },
    ],
    impactedEndpoints: [],
    factsByFile: {
      'src/api/public.ts': { endpoints: ['GET /public/data'], crons: [] },
      'src/server.ts': { endpoints: [], crons: ['reset-buckets (hourly)'] },
    },
    ...over,
  };
}

describe('mapFacadeBlast (compose BlastResult → BlastRadius)', () => {
  it('C.P0.1 — groups callers by the symbol they reach (one DownstreamImpact per symbol)', () => {
    const b = mapFacadeBlast(fb());
    expect(b.changed_symbols).toEqual([{ name: 'rateLimit', file: 'src/mw/ratelimit.ts', kind: 'function' }]);
    expect(b.downstream).toHaveLength(1);
    const d = b.downstream[0]!;
    expect(d.symbol).toBe('rateLimit');
    expect(d.callers.map((c) => `${c.file}:${c.line}`)).toEqual(
      expect.arrayContaining(['src/api/public.ts:23', 'src/server.ts:88']),
    );
  });

  it('C.P0.2 — attributes endpoints/crons from each caller file (union, deduped)', () => {
    const d = mapFacadeBlast(fb()).downstream[0]!;
    expect(d.endpoints_affected).toEqual(['GET /public/data']);
    expect(d.crons_affected).toEqual(['reset-buckets (hourly)']);
  });

  it('C.P1.3 — classifies endpoint-reachable callers as "business" + carries the declaring file', () => {
    const b = mapFacadeBlast(fb());
    const d = b.downstream[0]!;
    expect(d.file).toBe('src/mw/ratelimit.ts'); // declaring file threaded through
    // src/api/public.ts has an endpoint fact → business; src/server.ts has a cron → business
    expect(d.callers.find((c) => c.file === 'src/api/public.ts')!.role).toBe('business');
    expect(d.callers.find((c) => c.file === 'src/server.ts')!.role).toBe('business');
  });

  it('C.P0.3 — duplicate caller rows collapse to one', () => {
    const dup = fb({
      callers: [
        { file: 'src/api/public.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 50 },
        { file: 'src/api/public.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 50 },
      ],
    });
    expect(mapFacadeBlast(dup).downstream[0]!.callers).toHaveLength(1);
  });

  it('N.P0.1 — caps at 20 callers per symbol, highest file-rank kept', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      file: `src/f${i}.ts`,
      symbol: `s${i}`,
      viaSymbol: 'rateLimit',
      line: i + 1,
      rank: i, // rank 29 is highest
    }));
    const d = mapFacadeBlast(fb({ callers: many, factsByFile: {} })).downstream[0]!;
    expect(d.callers).toHaveLength(20);
    expect(d.callers[0]!.file).toBe('src/f29.ts'); // highest rank first
    expect(d.callers.some((c) => c.file === 'src/f0.ts')).toBe(false); // lowest dropped
  });

  it('N.P0.2 — excludes the declaring file from callers', () => {
    const withSelf = fb({
      callers: [
        { file: 'src/mw/ratelimit.ts', symbol: 'self', viaSymbol: 'rateLimit', line: 5, rank: 99 },
        { file: 'src/api/public.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 23, rank: 50 },
      ],
      factsByFile: {},
    });
    const d = mapFacadeBlast(withSelf).downstream[0]!;
    expect(d.callers.every((c) => c.file !== 'src/mw/ratelimit.ts')).toBe(true);
    expect(d.callers).toHaveLength(1);
  });
});

describe('summarizeBlast (C.P1.1)', () => {
  it('composes the one-line summary with sing/plural', () => {
    const symbols = [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }];
    const downstream = [
      { symbol: 'rateLimit', callers: [{ name: 'h', file: 'p.ts', line: 1 }], endpoints_affected: ['GET /x'], crons_affected: [] },
    ];
    expect(summarizeBlast(symbols, downstream)).toBe(
      '1 changed symbol · 1 downstream caller · 1 endpoint affected.',
    );
  });

  it('returns NO_SYMBOLS_SUMMARY when nothing changed', () => {
    expect(summarizeBlast([], [])).toMatch(/no top-level symbols/i);
  });
});

describe('callerName (C.P1.2)', () => {
  it('names the enclosing top-level symbol of a caller line, else the file basename', () => {
    const syms = [
      { path: 'src/api/public.ts', name: 'handler', kind: 'function', line: 10 },
      { path: 'src/api/public.ts', name: 'other', kind: 'function', line: 40 },
    ] as never[];
    expect(callerName(syms, { fromPath: 'src/api/public.ts', toSymbol: 'x', line: 23 } as never)).toBe('handler');
    expect(callerName([], { fromPath: 'src/server.ts', toSymbol: 'x', line: 5 } as never)).toBe('server.ts');
  });
});
