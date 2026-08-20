/* Shared display formatters. Anything used by more than one feature folder
   belongs here; single-consumer helpers stay colocated with their component. */

/** Rendered in place of any number we do not have. Never show "$0.00" instead. */
export const EMPTY = "—";

/**
 * USD cost of a single run, e.g. "$0.0013", "$0.014", "$0.06".
 *
 * Run costs span three orders of magnitude — a flash model on a small diff is
 * ~$0.001, a frontier model on a large one is ~$0.10 — so a fixed precision is
 * either lossy at the bottom or noisy at the top. Formatting to 4dp and trimming
 * trailing zeros (down to a 2dp floor, so whole cents still read as money) gives
 * one rule that renders every band the way a person would write it.
 *
 * `null` means "we have no cost for this run" and renders as "—". That is a
 * different statement from "$0.00", which means the run genuinely was free — the
 * price book lists free models at 0.
 */
export function formatCostUsd(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return EMPTY;
  if (usd === 0) return "$0.00";
  // Below 4dp resolution the trimmed output would round to "$0.0000", which
  // reads as free. Say "smaller than we display" instead.
  if (usd < 0.0001) return "<$0.0001";
  const [whole, frac = ""] = usd.toFixed(4).split(".");
  return `$${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

/**
 * Token count with space thousands separators, e.g. 9119 → "9 119". Spaces
 * rather than commas so the number reads as a quantity next to a dollar figure
 * without the two punctuation styles competing.
 *
 * Grouped by regex rather than `toLocaleString` + replace, so the separator is a
 * plain U+0020 that a test can type. The locale-aware version is a trap here:
 * its output is an ICU build detail, and it is far too easy to substitute a
 * look-alike THIN SPACE that renders identically but fails string equality.
 */
export function formatTokenCount(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
