import { SIZE_MEDIUM_MAX, SIZE_SMALL_MAX, type PrMeta, type SizeInfo } from "./constants";

/** Bucket a PR into S/M/L by total changed lines. */
export function sizeOf(pr: PrMeta): SizeInfo {
  const lines = pr.additions + pr.deletions;
  const size = lines < SIZE_SMALL_MAX ? "S" : lines < SIZE_MEDIUM_MAX ? "M" : "L";
  return { size, lines };
}

/**
 * The FINDINGS column's read of the payload. Everything that touches the
 * findings shape goes through these two, so a contract change is a one-function
 * edit rather than a hunt through the cell.
 */

/** Per-severity badge counts, or null when the PR has never been reviewed.
 *  A reviewed-but-clean PR returns zeroes, not null — the caller renders "—"
 *  for both, but only null means "no review has run". */
export function severityCounts(
  pr: PrMeta,
): { CRITICAL: number; WARNING: number; SUGGESTION: number } | null {
  if (pr.critical_count == null && pr.warning_count == null && pr.suggestion_count == null) {
    return null;
  }
  return {
    CRITICAL: pr.critical_count ?? 0,
    WARNING: pr.warning_count ?? 0,
    SUGGESTION: pr.suggestion_count ?? 0,
  };
}

/** How many findings the counts include but the embedded list omits — the API
 *  caps the array at 10 while the counts stay uncapped. 0 when nothing is
 *  hidden. */
export function hiddenFindingsCount(pr: PrMeta): number {
  const counts = severityCounts(pr);
  if (!counts) return 0;
  const total = counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
  return Math.max(0, total - (pr.findings?.length ?? 0));
}

/** Compact relative time for the list's UPDATED column (e.g. "3h", "2d"). */
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
