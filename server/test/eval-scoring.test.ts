/**
 * eval/scoring.ts unit tests — pure functions, hermetic (no DB/network/LLM).
 *
 * NO-LLM ASSERTION: this file never imports, constructs, or invokes any
 * `LLMProvider` (mock or real) — `scoring.ts` is zero-I/O by construction
 * (AC-23), so there is nothing to mock. Confirmed by inspection: the only
 * import below is from `../src/modules/eval/scoring.js` and `@devdigest/shared`
 * (types only); no `src/adapters/mocks.js` MockLLMProvider import exists in
 * this file, and none is needed for any of the assertions below.
 */
import { describe, it, expect } from 'vitest';
import {
  matchesExpectation,
  scoreCase,
  aggregateRecall,
  aggregatePrecision,
  aggregateCitationAccuracy,
  computeCitationAccuracy,
  casePassed,
  computeAgentSnapshot,
  computeFlakedStatus,
  type FindingLike,
  type CaseScoreResult,
} from '../src/modules/eval/scoring.js';
import type { Expectation } from '@devdigest/shared';

function mustFind(overrides: Partial<Expectation> = {}): Expectation {
  return {
    type: 'must_find',
    file: 'src/services/foo.ts',
    line_start: 10,
    line_end: 15,
    severity: 'critical',
    kind: 'sql-injection',
    ...overrides,
  };
}

function mustNotFlag(overrides: Partial<Expectation> = {}): Expectation {
  return {
    type: 'must_not_flag',
    file: 'src/services/foo.ts',
    line_start: 30,
    line_end: 35,
    severity: null,
    kind: null,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingLike> = {}): FindingLike {
  return {
    file: 'src/services/foo.ts',
    startLine: 12,
    endLine: 12,
    ...overrides,
  };
}

describe('matchesExpectation', () => {
  it('matches on exact same file and exact line match', () => {
    const exp = mustFind({ line_start: 12, line_end: 12 });
    expect(matchesExpectation(finding({ startLine: 12, endLine: 12 }), exp)).toBe(true);
  });

  it('matches when ranges overlap but are not identical', () => {
    const exp = mustFind({ line_start: 10, line_end: 15 });
    // finding spans 14-20, overlapping only the tail of the expectation range
    expect(matchesExpectation(finding({ startLine: 14, endLine: 20 }), exp)).toBe(true);
  });

  it('does not match when line ranges do not overlap', () => {
    const exp = mustFind({ line_start: 10, line_end: 15 });
    expect(matchesExpectation(finding({ startLine: 20, endLine: 25 }), exp)).toBe(false);
  });

  it('does not match when file differs even if lines overlap', () => {
    const exp = mustFind({ file: 'src/services/foo.ts', line_start: 10, line_end: 15 });
    expect(matchesExpectation(finding({ file: 'src/services/bar.ts', startLine: 12, endLine: 12 }), exp)).toBe(
      false,
    );
  });

  it('never reads severity or kind in the matching decision', () => {
    // Same file/lines, wildly different severity/kind on both sides — must still match.
    const exp = mustFind({ line_start: 10, line_end: 15, severity: 'critical', kind: 'sql-injection' });
    const f = finding({ startLine: 12, endLine: 12 });
    expect(matchesExpectation(f, exp)).toBe(true);
    const expOtherMeta = mustFind({ line_start: 10, line_end: 15, severity: 'suggestion', kind: 'style' });
    expect(matchesExpectation(f, expOtherMeta)).toBe(true);
  });
});

describe('scoreCase', () => {
  it('empty expectations array (clean diff case) returns all-zero counts, no special branch needed', () => {
    const result = scoreCase([], [finding()]);
    expect(result).toEqual<CaseScoreResult>({
      mustFindMatched: 0,
      mustFindTotal: 0,
      mustNotFlagViolations: 0,
      findingsCount: 1,
    });
  });

  it('matches a must_find expectation when any kept finding covers it', () => {
    const result = scoreCase([mustFind({ line_start: 10, line_end: 15 })], [finding({ startLine: 12, endLine: 12 })]);
    expect(result.mustFindMatched).toBe(1);
    expect(result.mustFindTotal).toBe(1);
    expect(result.mustNotFlagViolations).toBe(0);
  });

  it('must_not_flag-only case: zero must_find denominator, violation counted when a kept finding matches the guarded zone', () => {
    const result = scoreCase(
      [mustNotFlag({ line_start: 30, line_end: 35 })],
      [finding({ startLine: 32, endLine: 32 })],
    );
    expect(result.mustFindTotal).toBe(0);
    expect(result.mustFindMatched).toBe(0);
    expect(result.mustNotFlagViolations).toBe(1);
    expect(result.findingsCount).toBe(1);
  });

  it('must_not_flag with no matching kept finding produces zero violations', () => {
    const result = scoreCase([mustNotFlag({ line_start: 30, line_end: 35 })], [finding({ startLine: 12, endLine: 12 })]);
    expect(result.mustNotFlagViolations).toBe(0);
  });

  it('zero-findings batch: must_find expectations present but no findings kept at all', () => {
    const result = scoreCase([mustFind({ line_start: 10, line_end: 15 })], []);
    expect(result).toEqual<CaseScoreResult>({
      mustFindMatched: 0,
      mustFindTotal: 1,
      mustNotFlagViolations: 0,
      findingsCount: 0,
    });
  });

  it('mixes must_find and must_not_flag expectations independently', () => {
    const result = scoreCase(
      [mustFind({ line_start: 10, line_end: 15 }), mustNotFlag({ line_start: 30, line_end: 35 })],
      [finding({ startLine: 12, endLine: 12 }), finding({ startLine: 33, endLine: 33 })],
    );
    expect(result.mustFindMatched).toBe(1);
    expect(result.mustFindTotal).toBe(1);
    expect(result.mustNotFlagViolations).toBe(1);
    expect(result.findingsCount).toBe(2);
  });

  it('N1: one kept finding overlapping TWO must_not_flag zones counts as only ONE violation, never exceeding findingsCount', () => {
    // Two guarded zones that both cover line 32; a single kept finding at
    // line 32 overlaps both. Per-expectation counting would double-count
    // this as violations=2 with findingsCount=1, driving precision below 0.
    const result = scoreCase(
      [mustNotFlag({ line_start: 30, line_end: 35 }), mustNotFlag({ line_start: 31, line_end: 33 })],
      [finding({ startLine: 32, endLine: 32 })],
    );
    expect(result.findingsCount).toBe(1);
    expect(result.mustNotFlagViolations).toBe(1);
    expect(result.mustNotFlagViolations).toBeLessThanOrEqual(result.findingsCount);
  });
});

describe('casePassed', () => {
  it('passes when all must_find matched and zero must_not_flag violations', () => {
    expect(casePassed({ mustFindMatched: 2, mustFindTotal: 2, mustNotFlagViolations: 0, findingsCount: 2 })).toBe(
      true,
    );
  });

  it('fails when not all must_find matched', () => {
    expect(casePassed({ mustFindMatched: 1, mustFindTotal: 2, mustNotFlagViolations: 0, findingsCount: 1 })).toBe(
      false,
    );
  });

  it('fails when any must_not_flag violation occurred', () => {
    expect(casePassed({ mustFindMatched: 2, mustFindTotal: 2, mustNotFlagViolations: 1, findingsCount: 3 })).toBe(
      false,
    );
  });

  it('passes for the clean-diff empty-expectations case (0/0 matched, 0 violations)', () => {
    expect(casePassed({ mustFindMatched: 0, mustFindTotal: 0, mustNotFlagViolations: 0, findingsCount: 0 })).toBe(
      true,
    );
  });
});

describe('aggregateRecall', () => {
  it('sums matched/total across cases', () => {
    const cases: CaseScoreResult[] = [
      { mustFindMatched: 1, mustFindTotal: 2, mustNotFlagViolations: 0, findingsCount: 1 },
      { mustFindMatched: 2, mustFindTotal: 2, mustNotFlagViolations: 0, findingsCount: 2 },
    ];
    expect(aggregateRecall(cases)).toBeCloseTo(3 / 4);
  });

  it('returns 1 (vacuously satisfied) when total must_find denominator is zero across the whole batch', () => {
    const cases: CaseScoreResult[] = [
      { mustFindMatched: 0, mustFindTotal: 0, mustNotFlagViolations: 1, findingsCount: 1 },
      { mustFindMatched: 0, mustFindTotal: 0, mustNotFlagViolations: 0, findingsCount: 0 },
    ];
    expect(aggregateRecall(cases)).toBe(1);
  });

  it('returns 1 for an empty batch (no cases at all)', () => {
    expect(aggregateRecall([])).toBe(1);
  });
});

describe('aggregatePrecision', () => {
  it('computes (findings - violations) / findings across cases', () => {
    const cases: CaseScoreResult[] = [
      { mustFindMatched: 1, mustFindTotal: 1, mustNotFlagViolations: 1, findingsCount: 4 },
      { mustFindMatched: 1, mustFindTotal: 1, mustNotFlagViolations: 0, findingsCount: 1 },
    ];
    // total findings = 5, total violations = 1 -> 4/5
    expect(aggregatePrecision(cases)).toBeCloseTo(4 / 5);
  });

  it('returns 1 (vacuously satisfied) when total findingsCount is zero across the batch', () => {
    const cases: CaseScoreResult[] = [
      { mustFindMatched: 0, mustFindTotal: 1, mustNotFlagViolations: 0, findingsCount: 0 },
    ];
    expect(aggregatePrecision(cases)).toBe(1);
  });

  it('N1: clamps to >= 0 even if a caller somehow supplies violations > findingsCount', () => {
    // scoreCase itself can no longer produce this (violations capped at
    // findingsCount), but aggregatePrecision's own clamp is defense-in-depth
    // against underflow at the aggregate level regardless of caller.
    const cases: CaseScoreResult[] = [
      { mustFindMatched: 0, mustFindTotal: 0, mustNotFlagViolations: 2, findingsCount: 1 },
    ];
    expect(aggregatePrecision(cases)).toBe(0);
    expect(aggregatePrecision(cases)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeCitationAccuracy', () => {
  it('computes kept / (kept + dropped)', () => {
    expect(computeCitationAccuracy(3, 1)).toBeCloseTo(3 / 4);
  });

  it('returns 1 when both kept and dropped are zero', () => {
    expect(computeCitationAccuracy(0, 0)).toBe(1);
  });

  it('returns 1 when nothing was dropped (perfect citation accuracy)', () => {
    expect(computeCitationAccuracy(5, 0)).toBe(1);
  });

  it('returns 0 when everything was dropped', () => {
    expect(computeCitationAccuracy(0, 5)).toBe(0);
  });
});

describe('aggregateCitationAccuracy', () => {
  it('pools kept/dropped across cases rather than averaging per-case ratios (AC-22, #13)', () => {
    // Spec worked example: case A = 1.0 (kept 1, dropped 0), case B = 0.5
    // (kept 1, dropped 1). Naive average = 0.75; pooled = 2/(2+1) ≈ 0.667 —
    // NOT 0.75. (Re-derived here with the exact spec numbers: kept totals
    // 2, dropped totals 1 → 2/3.)
    const result = aggregateCitationAccuracy([
      { keptCount: 1, droppedCount: 0 },
      { keptCount: 1, droppedCount: 1 },
    ]);
    expect(result).toBeCloseTo(2 / 3);
    expect(result).not.toBeCloseTo(0.75);
  });

  it('returns 1 (vacuously satisfied) when no findings were proposed at all across the batch', () => {
    expect(aggregateCitationAccuracy([{ keptCount: 0, droppedCount: 0 }])).toBe(1);
    expect(aggregateCitationAccuracy([])).toBe(1);
  });

  it('weights a case with more findings proportionally more than a naive average would', () => {
    // Case with 100 findings all kept vs. a case with 1 finding, 1 dropped.
    // Naive average of ratios = (1 + 0)/2 = 0.5; pooled must be much closer
    // to 1 since the 100-finding case dominates the denominator.
    const result = aggregateCitationAccuracy([
      { keptCount: 100, droppedCount: 0 },
      { keptCount: 0, droppedCount: 1 },
    ]);
    expect(result).toBeCloseTo(100 / 101);
  });
});

describe('computeFlakedStatus', () => {
  it('is never flaked with fewer than 2 data points', () => {
    expect(computeFlakedStatus([])).toBe(false);
    expect(computeFlakedStatus(['passed'])).toBe(false);
    expect(computeFlakedStatus(['failed'])).toBe(false);
    expect(computeFlakedStatus(['error'])).toBe(false);
  });

  it('is not flaked when all outcomes are consistently passed', () => {
    expect(computeFlakedStatus(['passed', 'passed', 'passed'])).toBe(false);
  });

  it('is not flaked when all outcomes are consistently failed/error', () => {
    expect(computeFlakedStatus(['failed', 'error', 'failed'])).toBe(false);
  });

  it('is flaked when the sequence contains both a pass and a failure', () => {
    expect(computeFlakedStatus(['passed', 'failed'])).toBe(true);
  });

  it('is flaked when the sequence contains both a pass and an error', () => {
    expect(computeFlakedStatus(['error', 'passed', 'error'])).toBe(true);
  });

  it('is flaked regardless of order (pass first or failure first)', () => {
    expect(computeFlakedStatus(['failed', 'passed', 'passed'])).toBe(true);
    expect(computeFlakedStatus(['passed', 'passed', 'error'])).toBe(true);
  });
});

describe('computeAgentSnapshot', () => {
  const baseInput = {
    systemPrompt: 'You are a careful reviewer.',
    skills: ['security', 'zod'],
    model: 'claude-sonnet-5',
    provider: 'anthropic',
  };

  it('produces a stable fingerprint for the same input', () => {
    const a = computeAgentSnapshot({ ...baseInput });
    const b = computeAgentSnapshot({ ...baseInput });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('produces a different fingerprint when skill order changes', () => {
    const a = computeAgentSnapshot({ ...baseInput, skills: ['security', 'zod'] });
    const b = computeAgentSnapshot({ ...baseInput, skills: ['zod', 'security'] });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('produces a different fingerprint when the model changes', () => {
    const a = computeAgentSnapshot({ ...baseInput, model: 'claude-sonnet-5' });
    const b = computeAgentSnapshot({ ...baseInput, model: 'claude-haiku-4.5' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('produces a different fingerprint when the provider changes', () => {
    const a = computeAgentSnapshot({ ...baseInput, provider: 'anthropic' });
    const b = computeAgentSnapshot({ ...baseInput, provider: 'openrouter' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('produces a different fingerprint when only the system prompt changes (never derived from prompt alone, but prompt IS still an input)', () => {
    const a = computeAgentSnapshot({ ...baseInput, systemPrompt: 'Prompt A' });
    const b = computeAgentSnapshot({ ...baseInput, systemPrompt: 'Prompt B' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('two different agent configs (different model) sharing the exact same prompt still get different fingerprints (AC-17)', () => {
    const a = computeAgentSnapshot({ ...baseInput, model: 'model-a' });
    const b = computeAgentSnapshot({ ...baseInput, model: 'model-b' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('display object carries human-readable identity for UI tooltips', () => {
    const snap = computeAgentSnapshot(baseInput);
    expect(snap.display).toMatchObject({
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      skills: ['security', 'zod'],
    });
  });
});
