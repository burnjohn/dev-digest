import { describe, it, expect } from 'vitest';
import { capBlastCallers } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL, MAX_TOTAL_CALLER_ROWS } from '../src/modules/repo-intel/constants.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic coverage for `capBlastCallers` — the per-symbol-cap + global-
 * ceiling logic `tryPersistentBlast` (repo-intel/service.ts) applies to
 * resolved caller rows. Exported specifically so this can be unit-tested
 * without a database — the "Blast Radius — symbol list ordering & caller-cap
 * correctness" plan's D1 fix.
 *
 * `tryPersistentBlast` always calls this with an ALREADY rank-desc-sorted
 * array (`callers.sort((a, b) => b.rank - a.rank)` runs immediately before),
 * so every fixture here is pre-sorted, matching the real call site.
 */

function row(overrides: Partial<BlastCallerRow> & { file: string; rank: number }): BlastCallerRow {
  return {
    symbol: 'caller',
    viaSymbol: 'foo',
    line: 1,
    declFile: 'src/a.ts',
    ...overrides,
  };
}

describe('capBlastCallers — D1: the caller cap must be per changed symbol, not global', () => {
  it('two changed symbols each with >20 callers each keep their own 20 (RED before the fix, GREEN after)', () => {
    // 25 callers of symbol "foo" (declared in a.ts) + 25 callers of symbol
    // "bar" (declared in b.ts), already sorted rank-desc as the real call
    // site guarantees, interleaved so a naive flat `.slice(0, 20)` (the old
    // `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` bug) would starve one of
    // the two symbols entirely rather than capping each independently.
    const callers: BlastCallerRow[] = [];
    for (let i = 24; i >= 0; i -= 1) {
      callers.push(
        row({ file: `src/foo-caller-${i}.ts`, rank: i, viaSymbol: 'foo', declFile: 'src/a.ts' }),
      );
      callers.push(
        row({ file: `src/bar-caller-${i}.ts`, rank: i, viaSymbol: 'bar', declFile: 'src/b.ts' }),
      );
    }
    // re-sort rank desc, exactly like tryPersistentBlast does right before capping
    callers.sort((a, b) => b.rank - a.rank);

    const capped = capBlastCallers(callers);

    const fooCallers = capped.filter((c) => c.viaSymbol === 'foo');
    const barCallers = capped.filter((c) => c.viaSymbol === 'bar');

    // This is the assertion that fails under the OLD global
    // `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` behaviour — it would return
    // 20 rows TOTAL across both symbols (e.g. 10 "foo" + 10 "bar", or worse,
    // 20 of one and 0 of the other, depending on interleaving), never 20 for
    // EACH symbol.
    expect(fooCallers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(barCallers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(capped).toHaveLength(2 * MAX_CALLERS_PER_SYMBOL);

    // Each symbol keeps its highest-rank callers, sort-before-slice preserved.
    expect(fooCallers[0]!.rank).toBe(24);
    expect(fooCallers[19]!.rank).toBe(5);
    expect(barCallers[0]!.rank).toBe(24);
    expect(barCallers[19]!.rank).toBe(5);
  });

  it('two symbols sharing a NAME but declared in different files are capped independently (D2)', () => {
    const callers: BlastCallerRow[] = [];
    for (let i = 24; i >= 0; i -= 1) {
      callers.push(
        row({
          file: `src/caller-a-${i}.ts`,
          rank: i,
          viaSymbol: 'compileSafeRegex',
          declFile: 'src/conventions/helpers.ts',
        }),
      );
      callers.push(
        row({
          file: `src/caller-b-${i}.ts`,
          rank: i,
          viaSymbol: 'compileSafeRegex',
          declFile: 'src/platform/pattern-safety.ts',
        }),
      );
    }
    callers.sort((a, b) => b.rank - a.rank);

    const capped = capBlastCallers(callers);
    const fromA = capped.filter((c) => c.declFile === 'src/conventions/helpers.ts');
    const fromB = capped.filter((c) => c.declFile === 'src/platform/pattern-safety.ts');

    expect(fromA).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(fromB).toHaveLength(MAX_CALLERS_PER_SYMBOL);
  });

  it('under the per-symbol cap, all callers pass through untouched', () => {
    const callers: BlastCallerRow[] = [
      row({ file: 'src/c1.ts', rank: 3 }),
      row({ file: 'src/c2.ts', rank: 2 }),
      row({ file: 'src/c3.ts', rank: 1 }),
    ];
    expect(capBlastCallers(callers)).toHaveLength(3);
  });

  it('global ceiling never zeroes a symbol that has callers while another keeps all of its rows', () => {
    // 30 changed symbols, each with exactly 1 caller (well under the
    // per-symbol cap) — round-robin means a tight ceiling still gives every
    // symbol its 1 row before any symbol would be asked to give up a second.
    const callers: BlastCallerRow[] = Array.from({ length: 30 }, (_, i) =>
      row({ file: `src/caller-${i}.ts`, rank: 30 - i, viaSymbol: `sym${i}`, declFile: `src/${i}.ts` }),
    );
    const capped = capBlastCallers(callers, MAX_CALLERS_PER_SYMBOL, 10); // ceiling < number of symbols
    // 10 total rows, but spread across 10 DIFFERENT symbols (never all 10
    // rows piled onto the first few symbols while the rest get zero).
    const distinctSymbols = new Set(capped.map((c) => c.viaSymbol));
    expect(capped).toHaveLength(10);
    expect(distinctSymbols.size).toBe(10);
  });

  it('a ceiling at or above the default is a no-op for ordinary PRs (measured worst case: 366 symbols)', () => {
    const callers: BlastCallerRow[] = Array.from({ length: 366 }, (_, i) =>
      row({ file: `src/caller-${i}.ts`, rank: 366 - i, viaSymbol: `sym${i}`, declFile: `src/${i}.ts` }),
    );
    const capped = capBlastCallers(callers);
    expect(capped).toHaveLength(366);
    expect(capped.length).toBeLessThanOrEqual(MAX_TOTAL_CALLER_ROWS);
  });
});
