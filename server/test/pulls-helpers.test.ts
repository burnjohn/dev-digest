/**
 * PR-list rollups (`modules/pulls/helpers.ts`) — the pure "which row wins"
 * rules behind the list's SCORE, FINDINGS and COST columns.
 *
 * These used to be inline in `pulls/routes.ts` and were only reachable through
 * a live GitHub sync + three DB queries. They are pure now, so the rules that
 * actually matter — newest-first wins, per-agent union, null vs zeroed counts —
 * get covered without a database.
 */
import { describe, it, expect } from 'vitest';
import {
  countSeveritiesByPr,
  pickCountedReviews,
  pickLatestCostByPr,
  pickLatestReviewByPr,
  toPrMeta,
  type ReviewSummaryRow,
} from '../src/modules/pulls/helpers.js';
import type { PullRow } from '../src/modules/pulls/repository.js';

// Newest-first, as the repository returns them.
const rows: ReviewSummaryRow[] = [
  { id: 'r3', prId: 'pr1', agentId: 'agentB', score: 90 },
  { id: 'r2', prId: 'pr1', agentId: 'agentA', score: 70 },
  { id: 'r1', prId: 'pr1', agentId: 'agentA', score: 50 },
  { id: 'r0', prId: 'pr2', agentId: null, score: 10 },
];

describe('pickLatestReviewByPr', () => {
  it('takes the first row seen per PR (input is newest-first)', () => {
    const latest = pickLatestReviewByPr(rows);
    expect(latest.get('pr1')).toEqual({ id: 'r3', score: 90 });
    expect(latest.get('pr2')).toEqual({ id: 'r0', score: 10 });
  });

  it('is empty for no reviews', () => {
    expect(pickLatestReviewByPr([]).size).toBe(0);
  });
});

describe('pickCountedReviews', () => {
  it("keeps each agent's latest review, so a multi-agent PR counts the union", () => {
    const counted = pickCountedReviews(rows);
    // r3 (agentB) and r2 (agentA) survive; r1 is agentA's superseded review.
    expect([...counted.keys()].sort()).toEqual(['r0', 'r2', 'r3']);
    expect(counted.get('r2')).toBe('pr1');
    expect(counted.get('r3')).toBe('pr1');
  });

  it('treats a null agentId as its own agent bucket', () => {
    const counted = pickCountedReviews([
      { id: 'b', prId: 'pr1', agentId: null, score: null },
      { id: 'a', prId: 'pr1', agentId: null, score: null },
    ]);
    expect([...counted.keys()]).toEqual(['b']);
  });
});

describe('countSeveritiesByPr', () => {
  it('tallies severities per PR across the counted reviews', () => {
    const counted = pickCountedReviews(rows);
    const counts = countSeveritiesByPr(
      [
        { reviewId: 'r3', severity: 'CRITICAL' },
        { reviewId: 'r3', severity: 'WARNING' },
        { reviewId: 'r2', severity: 'CRITICAL' },
        { reviewId: 'r0', severity: 'SUGGESTION' },
      ],
      counted,
    );
    expect(counts.get('pr1')).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(counts.get('pr2')).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 1 });
  });

  it('ignores findings of superseded reviews and unknown severities', () => {
    const counts = countSeveritiesByPr(
      [
        { reviewId: 'r1', severity: 'CRITICAL' }, // superseded review
        { reviewId: 'r3', severity: 'NOPE' }, // not a known bucket
      ],
      pickCountedReviews(rows),
    );
    expect(counts.get('pr1')).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe('pickLatestCostByPr', () => {
  it('takes the newest run per PR and preserves an explicit null cost', () => {
    const cost = pickLatestCostByPr([
      { prId: 'pr1', costUsd: null },
      { prId: 'pr1', costUsd: 0.42 },
      { prId: 'pr2', costUsd: 1.5 },
      { prId: null, costUsd: 9 },
    ]);
    // pr1's newest run reported no usage → null wins over the older 0.42.
    expect(cost.get('pr1')).toBeNull();
    expect(cost.get('pr2')).toBe(1.5);
    expect(cost.size).toBe(2);
  });
});

describe('toPrMeta', () => {
  const now = Date.UTC(2026, 5, 11);
  const row = {
    id: 'pr1',
    number: 7,
    title: 'Add thing',
    author: 'octocat',
    branch: 'feat/thing',
    base: 'main',
    headSha: 'abc',
    additions: 10,
    deletions: 2,
    filesCount: 3,
    status: 'open',
    lastReviewedSha: 'abc',
    openedAt: new Date(now - 86_400_000),
    updatedAt: new Date(now - 86_400_000),
    body: null,
  } as PullRow;

  it('reports no findings_counts at all for an unreviewed PR', () => {
    const dto = toPrMeta(row, { now });
    expect(dto.findings_counts).toBeNull();
    expect(dto.score).toBeNull();
    expect(dto.cost_usd).toBeNull();
  });

  it('reports zeroed counts for a reviewed PR that found nothing', () => {
    const dto = toPrMeta(row, { review: { id: 'r1', score: 100 }, now });
    expect(dto.findings_counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(dto.score).toBe(100);
  });

  it('derives the review status rather than echoing the GitHub merge state', () => {
    expect(toPrMeta(row, { now }).status).toBe('reviewed');
    expect(toPrMeta({ ...row, lastReviewedSha: 'stale-sha' } as PullRow, { now }).status).toBe(
      'needs_review',
    );
  });
});
