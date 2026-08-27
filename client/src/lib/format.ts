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
 * Token flow for a single run, in→out, as `"8.2K→1.3K"` (the PR Brief band's
 * cost strip). One decimal, trailing `.0` trimmed, and the same null rule as
 * `formatCost`: both counts missing → `"—"`, a real zero → `"0"`.
 *
 * Deliberately NOT the same as `RunTraceDrawer/helpers.ts` `formatTokens`,
 * which renders `"8k→1.3k"` — zero decimals in, one out, lowercase. That one
 * belongs to a dense trace table where the column is narrow; this one is the
 * band's, where `8k` for 8,200 tokens reads as a rounding bug. Two formatters
 * for two surfaces, on purpose.
 */
export function formatTokenFlow(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn == null && tokensOut == null) return "—";
  const k = (n: number | null | undefined) => {
    if (n == null) return "—";
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  };
  return `${k(tokensIn)}→${k(tokensOut)}`;
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
