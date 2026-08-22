import type { PrMeta } from "@/lib/types";

/** Open PRs carry a derived review status; everything else is merged/closed. */
const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);

export interface PrListFilter {
  /** Active status chip; "all" disables status filtering. */
  status: string;
  /** Free-text query matched against the PR title or #number. */
  query: string;
  /** "oldest" sorts ascending by updated_at; anything else is newest-first. */
  sort: string;
}

/**
 * Filter the PR list by status + free-text query, then sort by `updated_at`.
 * Pure (no React, no I/O) so it unit-tests without a DOM; returns a new array.
 */
export function filterAndSortPulls(
  pulls: PrMeta[],
  { status, query, sort }: PrListFilter,
): PrMeta[] {
  const q = query.trim().toLowerCase();
  return pulls
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.updated_at ?? "") || 0;
      const tb = Date.parse(b.updated_at ?? "") || 0;
      return sort === "oldest" ? ta - tb : tb - ta;
    });
}

/** Header counts derived from the full (unfiltered) PR list. Pure. */
export function prListCounts(pulls: PrMeta[]): {
  openCount: number;
  needsReviewCount: number;
} {
  return {
    openCount: pulls.filter((p) => OPEN_STATUSES.has(p.status)).length,
    needsReviewCount: pulls.filter((p) => p.status === "needs_review").length,
  };
}
