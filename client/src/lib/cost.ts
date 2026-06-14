/**
 * Compact USD formatter for per-run generation cost.
 *
 * Cost is "tokens × price" — most review runs land well under a cent, so we
 * widen precision as the value shrinks (≈2 significant figures) instead of
 * rounding sub-cent runs to "$0.00", then trim trailing zeros down to a 2dp
 * floor ("$0.06", not "$0.060"; "$0.0013", not "$0.00").
 *
 * A genuine zero (free model) shows "$0.00"; MISSING data (un-priced run,
 * failed/cancelled, historical run from before cost was tracked) is `null` and
 * renders "—" — the two must stay visually distinct.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";

  // Decimals: 2 at a dollar+, otherwise enough to keep ~2 significant figures
  // (one extra place per leading zero after the decimal point).
  const decimals = usd >= 1 ? 2 : Math.floor(-Math.log10(usd)) + 2;

  // Trim trailing zeros but keep at least 2 decimal places.
  let str = usd.toFixed(decimals);
  if (str.includes(".")) {
    str = str.replace(/0+$/, "");
    const [int, frac = ""] = str.split(".");
    str = `${int}.${frac.padEnd(2, "0")}`;
  }
  return `$${str}`;
}
