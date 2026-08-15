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

/**
 * Compact relative time (e.g. "3h", "2d") for list columns. `null`/unparseable
 * → `"—"`, matching formatCost's null rule.
 *
 * Lives here rather than beside the PR list because it knows nothing about pull
 * requests — it is a formatter, like its neighbour. Its old home
 * (`app/repos/[repoId]/pulls/helpers.ts`) is for helpers that DO know the
 * domain, which is why `sizeOf` stayed there.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
