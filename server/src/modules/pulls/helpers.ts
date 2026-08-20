import type { PrDetail, PrMeta } from '@devdigest/shared';
import { EMPTY_SEVERITY_COUNTS } from './constants.js';
import { deriveReviewStatus } from './status.js';
import type { PrCommitRow, PrFileRow, PullRow } from './repository.js';

/**
 * F1 — pulls rollups and DTO mapping. Pure: no DB, no `this`, no IO, so every
 * rule below unit-tests without a database or a GitHub token.
 *
 * The PR list needs three review-derived columns that are computed on read
 * rather than denormalised onto `pull_requests`. The repository returns flat
 * newest-first rows; the "which row wins" rules live here.
 */

export interface PrSeverityCounts {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
}

export interface ReviewSummaryRow {
  id: string;
  prId: string;
  agentId: string | null;
  score: number | null;
}

/**
 * The latest review per PR — the source of the list's SCORE column.
 * Input must be newest-first, so the first row seen for a PR wins.
 */
export function pickLatestReviewByPr(
  rows: ReviewSummaryRow[],
): Map<string, { id: string; score: number | null }> {
  const latest = new Map<string, { id: string; score: number | null }>();
  for (const rv of rows) {
    if (!latest.has(rv.prId)) latest.set(rv.prId, { id: rv.id, score: rv.score });
  }
  return latest;
}

/**
 * The reviews whose findings the list counts: each agent's LATEST review, so a
 * PR reviewed by several agents shows the union of their current findings —
 * the same rule the client's hover preview applies to `/pulls/:id/reviews`.
 *
 * Returns reviewId → prId. Input must be newest-first.
 */
export function pickCountedReviews(rows: ReviewSummaryRow[]): Map<string, string> {
  const reviewToPr = new Map<string, string>();
  const seenPrAgent = new Set<string>();
  for (const rv of rows) {
    const agentKey = `${rv.prId}|${rv.agentId ?? 'none'}`;
    if (seenPrAgent.has(agentKey)) continue;
    seenPrAgent.add(agentKey);
    reviewToPr.set(rv.id, rv.prId);
  }
  return reviewToPr;
}

/**
 * Tally finding severities per PR. Counts match the detail page's per-run
 * counter chips — dismissed findings included. Unknown severities are ignored.
 */
export function countSeveritiesByPr(
  findings: { reviewId: string; severity: string }[],
  reviewToPr: Map<string, string>,
): Map<string, PrSeverityCounts> {
  const byPr = new Map<string, PrSeverityCounts>();
  for (const f of findings) {
    const prId = reviewToPr.get(f.reviewId);
    if (!prId) continue;
    let counts = byPr.get(prId);
    if (!counts) {
      counts = { ...EMPTY_SEVERITY_COUNTS };
      byPr.set(prId, counts);
    }
    if (f.severity in counts) counts[f.severity as keyof PrSeverityCounts] += 1;
  }
  return byPr;
}

/**
 * The latest completed run's cost per PR — the list's cost badge. Input must be
 * newest-first and already filtered to completed runs.
 */
export function pickLatestCostByPr(
  runs: { prId: string | null; costUsd: number | null }[],
): Map<string, number | null> {
  const byPr = new Map<string, number | null>();
  for (const run of runs) {
    if (run.prId && !byPr.has(run.prId)) byPr.set(run.prId, run.costUsd);
  }
  return byPr;
}

/** Row → PR-list DTO. `status` is the DERIVED review status, not GitHub's. */
export function toPrMeta(
  row: PullRow,
  ctx: {
    review?: { id: string; score: number | null };
    costUsd?: number | null;
    counts?: PrSeverityCounts;
    now: number;
  },
): PrMeta {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    status: deriveReviewStatus({
      ghStatus: row.status,
      lastReviewedSha: row.lastReviewedSha,
      headSha: row.headSha,
      updatedAt: row.updatedAt,
      now: ctx.now,
    }),
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    score: ctx.review ? ctx.review.score : null,
    cost_usd: ctx.costUsd ?? null,
    // A PR with no review shows no chips at all; a reviewed PR with no findings
    // shows zeroes. `null` and `{0,0,0}` are different states on the client.
    findings_counts: ctx.review ? (ctx.counts ?? { ...EMPTY_SEVERITY_COUNTS }) : null,
  };
}

/**
 * Persisted rows → PR-detail DTO. This is the OFFLINE path: what the endpoint
 * serves when GitHub is unreachable or no token is configured. Here `status` is
 * GitHub's merge state straight off the row, not a derived review status.
 */
export function toPrDetail(pr: PullRow, files: PrFileRow[], commits: PrCommitRow[]): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
