/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  selectLatestReviewPerAgent,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

const live = (severity: string) => ({ severity, dismissedAt: null });

describe('rollupSeverities', () => {
  it('tallies findings into CRITICAL / WARNING / SUGGESTION buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        live('CRITICAL'),
        live('CRITICAL'),
        live('WARNING'),
        live('SUGGESTION'),
        live('WEIRD'),
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it('skips dismissed findings — a resolved finding stops driving the counter', () => {
    expect(
      rollupSeverities([
        live('CRITICAL'),
        { severity: 'CRITICAL', dismissedAt: new Date() },
        { severity: 'WARNING', dismissedAt: new Date() },
      ]),
    ).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('counts low-confidence findings — confidence is a view filter, not a tally rule', () => {
    // The rollup never sees confidence at all; this pins that as intentional.
    expect(rollupSeverities([live('SUGGESTION'), live('SUGGESTION')])).toEqual({
      CRITICAL: 0,
      WARNING: 0,
      SUGGESTION: 2,
    });
  });
});

describe('selectLatestReviewPerAgent', () => {
  // Rows arrive newest-first, as the route's `order by created_at desc` yields.
  it('keeps only the newest review per agent, so a re-run replaces its own', () => {
    const keep = selectLatestReviewPerAgent([
      { reviewId: 'sec-new', agentId: 'security' },
      { reviewId: 'perf-new', agentId: 'perf' },
      { reviewId: 'perf-old', agentId: 'perf' },
      { reviewId: 'sec-old', agentId: 'security' },
    ]);
    expect([...keep].sort()).toEqual(['perf-new', 'sec-new']);
  });

  it('sums across different agents rather than picking one', () => {
    const keep = selectLatestReviewPerAgent([
      { reviewId: 'a', agentId: 'security' },
      { reviewId: 'b', agentId: 'perf' },
      { reviewId: 'c', agentId: 'general' },
    ]);
    expect(keep.size).toBe(3);
  });

  it('keeps every agent-less review — there is no agent to de-duplicate against', () => {
    const keep = selectLatestReviewPerAgent([
      { reviewId: 'x', agentId: null },
      { reviewId: 'y', agentId: null },
    ]);
    expect([...keep].sort()).toEqual(['x', 'y']);
  });

  it('handles the same review appearing once per finding row', () => {
    // The route joins findings→reviews, so one review yields N rows.
    const keep = selectLatestReviewPerAgent([
      { reviewId: 'sec-new', agentId: 'security' },
      { reviewId: 'sec-new', agentId: 'security' },
      { reviewId: 'sec-old', agentId: 'security' },
    ]);
    expect([...keep]).toEqual(['sec-new']);
  });

  it('is empty for no rows', () => {
    expect(selectLatestReviewPerAgent([]).size).toBe(0);
  });
});
