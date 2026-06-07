import { describe, it, expect } from 'vitest';
import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';
import { toReviewPayload, gateTriggered } from '../src/index.js';

/**
 * The review EVENT is computed deterministically from finding severities + the
 * `ci_fail_on` gate — NOT from the model's `verdict`. These tests pin that gate.
 */

function finding(severity: Finding['severity']): Finding {
  return {
    id: `f-${severity}`,
    severity,
    category: 'security',
    title: `${severity} finding`,
    file: 'src/x.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
  } as Finding;
}

function review(findings: Finding[]): Review {
  // verdict intentionally 'approve' to prove the EVENT ignores it.
  return { verdict: 'approve', score: 0, summary: 's', findings } as Review;
}

describe('toReviewPayload — deterministic CI gate', () => {
  it('no findings → APPROVE', () => {
    expect(toReviewPayload(review([]), { failOn: 'critical' }).event).toBe('APPROVE');
  });

  it("failOn 'critical' + only WARNING → COMMENT (does not block)", () => {
    const p = toReviewPayload(review([finding('WARNING')]), { failOn: 'critical' });
    expect(p.event).toBe('COMMENT');
  });

  it("failOn 'critical' + a CRITICAL → REQUEST_CHANGES (ignores verdict='approve')", () => {
    const p = toReviewPayload(review([finding('WARNING'), finding('CRITICAL')]), {
      failOn: 'critical',
    });
    expect(p.event).toBe('REQUEST_CHANGES');
  });

  it("failOn 'never' + a CRITICAL → COMMENT (never blocks)", () => {
    const p = toReviewPayload(review([finding('CRITICAL')]), { failOn: 'never' });
    expect(p.event).toBe('COMMENT');
  });

  it("failOn 'warning' + only WARNING → REQUEST_CHANGES", () => {
    expect(toReviewPayload(review([finding('WARNING')]), { failOn: 'warning' }).event).toBe(
      'REQUEST_CHANGES',
    );
  });

  it("failOn 'any' + only SUGGESTION → REQUEST_CHANGES", () => {
    expect(toReviewPayload(review([finding('SUGGESTION')]), { failOn: 'any' }).event).toBe(
      'REQUEST_CHANGES',
    );
  });

  it("defaults to 'critical' when failOn is omitted", () => {
    expect(toReviewPayload(review([finding('WARNING')])).event).toBe('COMMENT');
    expect(toReviewPayload(review([finding('CRITICAL')])).event).toBe('REQUEST_CHANGES');
  });

  it('body header reflects the computed event, not the model verdict', () => {
    const blocked = toReviewPayload(review([finding('CRITICAL')]), { failOn: 'critical' });
    expect(blocked.body).toContain('Changes requested');
  });
});

/**
 * Inline comments must anchor to a real new-side diff line. Grounding only proves
 * the finding's *range* touches the diff, so `end_line` can be an unchanged line;
 * posting there yields GitHub 422 "Line could not be resolved" and rejects the
 * whole review. These tests pin the anchoring behavior.
 */
function findingRange(file: string, start: number, end: number): Finding {
  return {
    id: `f-${file}-${start}-${end}`,
    severity: 'WARNING',
    category: 'security',
    title: `finding ${start}-${end}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'because',
  } as Finding;
}

function diffWith(file: string, newLineNumbers: number[]): UnifiedDiff {
  return {
    raw: '',
    files: [
      {
        path: file,
        additions: newLineNumbers.length,
        deletions: 0,
        hunks: [
          {
            file,
            oldStart: newLineNumbers[0] ?? 1,
            oldLines: 0,
            newStart: newLineNumbers[0] ?? 1,
            newLines: newLineNumbers.length,
            newLineNumbers,
          },
        ],
      },
    ],
  } as UnifiedDiff;
}

describe('toReviewPayload — inline comment line anchoring', () => {
  it('anchors to the in-diff line nearest end_line, not a raw end_line outside the diff', () => {
    // range 10–30 intersects the diff (line 12 changed), but end_line 30 is not.
    const r = review([findingRange('src/x.ts', 10, 30)]);
    const p = toReviewPayload(r, { failOn: 'critical', diff: diffWith('src/x.ts', [12]) });
    expect(p.comments).toEqual([expect.objectContaining({ path: 'src/x.ts', line: 12 })]);
  });

  it('drops the inline comment when no line in range is in the diff (kept in body)', () => {
    const r = review([findingRange('src/x.ts', 10, 30)]);
    const p = toReviewPayload(r, { failOn: 'critical', diff: diffWith('src/x.ts', [500]) });
    expect(p.comments ?? []).toHaveLength(0);
    expect(p.body).toContain('finding 10-30'); // never silent — still in the summary
  });

  it('without a diff, falls back to the legacy end_line anchor', () => {
    const r = review([findingRange('src/x.ts', 10, 30)]);
    const p = toReviewPayload(r, { failOn: 'critical' });
    expect(p.comments).toEqual([expect.objectContaining({ line: 30 })]);
  });
});

describe('gateTriggered', () => {
  it('ranks severities and respects the policy floor', () => {
    expect(gateTriggered([finding('WARNING')], 'critical')).toBe(false);
    expect(gateTriggered([finding('CRITICAL')], 'critical')).toBe(true);
    expect(gateTriggered([finding('SUGGESTION')], 'warning')).toBe(false);
    expect(gateTriggered([finding('WARNING')], 'warning')).toBe(true);
    expect(gateTriggered([finding('CRITICAL')], 'never')).toBe(false);
    expect(gateTriggered([], 'any')).toBe(false);
  });
});
