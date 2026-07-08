import { describe, it, expect } from 'vitest';
import { capCallersPerSymbol } from '../src/modules/repo-intel/helpers.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

/**
 * Regression guard for the blast per-symbol caller cap.
 *
 * The bug: `tryPersistentBlast` capped the whole rank-sorted caller list with a
 * single global `slice(0, MAX_CALLERS_PER_SYMBOL)`. On a large PR (>cap total
 * callers) a low-rank but endpoint-bearing caller (e.g. `app.ts`, which reaches
 * `GET /health`) fell outside the global top-N and was dropped, erasing the
 * endpoint/cron attribution of the symbol it reached. The cap must be PER
 * changed symbol (`viaSymbol`), not global.
 */
function caller(viaSymbol: string, file: string, rank: number): BlastCallerRow {
  return { file, symbol: `enc_${file}`, viaSymbol, line: 1, rank };
}

describe('capCallersPerSymbol', () => {
  it('keeps up to `cap` callers PER symbol, not globally', () => {
    // Symbol A has 25 high-rank callers; symbol B has 1 low-rank caller.
    const aCallers = Array.from({ length: 25 }, (_, i) =>
      caller('A', `a${i}.ts`, 100 - i),
    );
    const bCaller = caller('B', 'app.ts', 0.001); // lowest rank of all
    const capped = capCallersPerSymbol([...aCallers, bCaller], 20);

    // A is capped at 20; B's single low-rank caller SURVIVES (a global cap of 20
    // would have dropped it, since it ranks 26th overall).
    expect(capped.filter((c) => c.viaSymbol === 'A')).toHaveLength(20);
    expect(capped.filter((c) => c.viaSymbol === 'B')).toHaveLength(1);
    expect(capped.some((c) => c.file === 'app.ts')).toBe(true);
  });

  it('keeps each symbol’s highest-rank callers when over the cap', () => {
    // Pre-sorted highest-rank first (as the service sorts before capping).
    const callers = [
      caller('A', 'hi.ts', 9),
      caller('A', 'mid.ts', 5),
      caller('A', 'lo.ts', 1),
    ];
    const capped = capCallersPerSymbol(callers, 2);
    expect(capped.map((c) => c.file)).toEqual(['hi.ts', 'mid.ts']);
  });

  it('returns everything unchanged when under the cap', () => {
    const callers = [caller('A', 'x.ts', 3), caller('B', 'y.ts', 2)];
    expect(capCallersPerSymbol(callers, 20)).toEqual(callers);
  });
});
