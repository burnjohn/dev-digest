/**
 * F1 — pulls module constants.
 */

/**
 * Diff stats are absent from GitHub's PR-*list* payload, so freshly-imported
 * PRs land with zeroed size/diff and need a per-PR detail fetch to backfill.
 * Capped per request so one list read cannot fan out into an unbounded number
 * of GitHub calls — the client's periodic refetch chips away at any remainder.
 */
export const BACKFILL_LIMIT = 10;

/** Severity buckets surfaced on the PR list, in the wire contract's casing. */
export const EMPTY_SEVERITY_COUNTS = {
  CRITICAL: 0,
  WARNING: 0,
  SUGGESTION: 0,
} as const;
