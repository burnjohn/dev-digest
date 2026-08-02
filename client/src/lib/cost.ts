/* cost.ts — USD formatting for per-run review cost.
   Runs cost fractions of a cent, so a flat toFixed(2) would render almost every
   real value as "$0.00". These helpers keep three states distinct:
     unknown (null)  → "—"
     genuinely free  → "$0.00"
     tiny but real   → "$0.0013"
*/

/** Total tokens with thousands separators, e.g. 9119 → "9,119". */
export function formatTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  return ((tokensIn ?? 0) + (tokensOut ?? 0)).toLocaleString("en-US");
}

/**
 * USD for display. Null/undefined means "we don't know what this cost" — a
 * failed run, an unpriced model, or a row written before cost was tracked — and
 * must never be shown as $0.00, which claims the run was free.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0.00";

  const abs = Math.abs(usd);
  // Below a dollar, show two significant digits so sub-cent runs stay readable;
  // at or above a dollar, cents are the useful precision.
  const decimals = abs >= 1 ? 2 : Math.floor(-Math.log10(abs)) + 2;

  let str = usd.toFixed(decimals);
  if (str.includes(".")) {
    str = str.replace(/0+$/, "");
    const [int, frac = ""] = str.split(".");
    str = `${int}.${frac.padEnd(2, "0")}`;
  }
  return `$${str}`;
}
