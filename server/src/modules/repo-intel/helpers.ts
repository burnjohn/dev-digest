import type { BlastCallerRow } from './types.js';

/**
 * Cap resolved callers PER changed symbol (`viaSymbol`), preserving input order.
 *
 * Callers arrive rank-sorted (highest rank first). A GLOBAL cap
 * (`callers.slice(0, cap)`) silently drops low-rank but endpoint-bearing callers
 * — e.g. a registration file like `app.ts` — once a PR has more than `cap` total
 * callers, erasing the endpoint/cron attribution of every changed symbol whose
 * only route-bearing caller ranked outside the global top-`cap`. Capping per
 * symbol keeps each symbol's own top-`cap` callers, preserving that attribution
 * on large PRs.
 */
export function capCallersPerSymbol(callers: BlastCallerRow[], cap: number): BlastCallerRow[] {
  const perSymbolCount = new Map<string, number>();
  const out: BlastCallerRow[] = [];
  for (const c of callers) {
    const n = perSymbolCount.get(c.viaSymbol) ?? 0;
    if (n >= cap) continue;
    perSymbolCount.set(c.viaSymbol, n + 1);
    out.push(c);
  }
  return out;
}
