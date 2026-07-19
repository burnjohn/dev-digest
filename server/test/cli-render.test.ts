import { describe, it, expect } from 'vitest';
import type { Finding, Review } from '@devdigest/shared';
import { renderReview } from '../src/cli/render.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded secret key',
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    rationale: 'sk_live token committed in plaintext',
    suggestion: 'Move it to an env var',
    confidence: 0.98,
    kind: 'finding',
    ...over,
  } as Finding;
}
const review = (findings: Finding[], score = 50): Review =>
  ({ verdict: 'request_changes', summary: 's', score, findings }) as Review;

describe('renderReview — terminal report (no color for stable assertions)', () => {
  it('R.P0.1 — prints file:line, severity and title for each finding', () => {
    const out = renderReview(review([finding()]), { mode: 'working', color: false });
    expect(out).toContain('src/config.ts:11');
    expect(out).toContain('CRITICAL');
    expect(out).toContain('Hardcoded secret key');
    expect(out).toContain('Move it to an env var'); // suggestion shown
  });

  it('R.P0.2 — empty findings → explicit "no issues" state, not a blank screen', () => {
    const out = renderReview(review([], 95), { mode: 'working', color: false });
    expect(out).toMatch(/no issues/i);
    expect(out).toContain('95/100');
  });

  it('R.P1.1 — orders blockers first and summarizes counts', () => {
    const out = renderReview(
      review([
        finding({ id: 's', severity: 'SUGGESTION', title: 'nit', start_line: 5, end_line: 5 }),
        finding({ id: 'c', severity: 'CRITICAL', title: 'blocker', start_line: 11, end_line: 11 }),
      ]),
      { mode: 'working', color: false },
    );
    // CRITICAL block appears before the SUGGESTION block
    expect(out.indexOf('blocker')).toBeLessThan(out.indexOf('nit'));
    expect(out).toContain('1 critical');
    expect(out).toContain('1 suggestion');
  });

  it('R.P1.2 — collapses a single-line range to file:line, keeps ranges otherwise', () => {
    const one = renderReview(review([finding({ start_line: 11, end_line: 11 })]), { mode: 'working', color: false });
    const many = renderReview(review([finding({ start_line: 11, end_line: 14 })]), { mode: 'working', color: false });
    expect(one).toContain('src/config.ts:11');
    expect(many).toContain('src/config.ts:11-14');
  });
});
