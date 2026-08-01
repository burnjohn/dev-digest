import type { PrStatus, SeverityCounts } from '@devdigest/shared';

/**
 * PR-list rollup helpers (pure — no DB / `this`, so they unit-test cleanly).
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

/** Zero counts — the shape a reviewed PR with no findings reports. */
export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/**
 * Tally finding severities for the list's FINDINGS column.
 *
 * DISMISSED findings are skipped: dismissing one is the user saying "this is
 * handled", and a resolved finding must stop driving the counter. Confidence is
 * NOT considered — "hide low confidence" is a view-level toggle on the detail
 * panel, not a decision about what exists. Unknown severity strings (the column
 * is plain `text`, with no enum or CHECK behind it) are ignored rather than
 * throwing, so one bad row cannot blank a whole PR list.
 */
export function rollupSeverities(
  rows: { severity: string; dismissedAt: Date | null }[],
): SeverityCounts {
  const c = emptySeverityCounts();
  for (const r of rows) {
    if (r.dismissedAt) continue;
    if (r.severity === 'CRITICAL') c.CRITICAL += 1;
    else if (r.severity === 'WARNING') c.WARNING += 1;
    else if (r.severity === 'SUGGESTION') c.SUGGESTION += 1;
  }
  return c;
}

/**
 * Pick the reviews whose findings count toward one PR's breakdown: the LATEST
 * review of EACH agent.
 *
 * A PR reviewed by a Security and a Performance agent should sum both — they
 * found different things. But re-running the SAME agent replaces its earlier
 * verdict rather than adding to it, so an old run must not inflate the count.
 *
 * `rows` must arrive newest-first (the caller orders by `created_at desc`), so
 * the first row seen per agent is that agent's latest. Reviews with a null
 * `agentId` have no agent to de-duplicate against, so each one counts on its
 * own — dropping all but one would silently hide findings.
 */
export function selectLatestReviewPerAgent(
  rows: { reviewId: string; agentId: string | null }[],
): Set<string> {
  const keep = new Set<string>();
  const seenAgents = new Set<string>();
  for (const r of rows) {
    if (r.agentId === null) {
      keep.add(r.reviewId);
      continue;
    }
    if (seenAgents.has(r.agentId)) continue;
    seenAgents.add(r.agentId);
    keep.add(r.reviewId);
  }
  return keep;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}
