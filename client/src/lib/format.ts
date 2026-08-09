/** Shared display formatters (client-wide). */

/**
 * Format an LLM cost in USD for display. Used by the PR list COST column, the
 * run timeline (`tok · $`), and the trace drawer's COST tile.
 *
 * - `null` / `undefined` → `"—"` (the null rule: never render `$0.00` for
 *   missing data; only a real zero-cost run shows `$0.00`).
 * - otherwise a `$`-prefixed amount with trailing zeros trimmed but **≥ 2**
 *   decimals kept: `0.014 → $0.014`, `0.0013 → $0.0013`, `0.06 → $0.06`,
 *   `0 → $0.00`.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  let s = usd.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const [, dec = ""] = s.split(".");
  if (dec.length < 2) s = usd.toFixed(2);
  return `$${s}`;
}
