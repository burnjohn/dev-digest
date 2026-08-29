import { describe, it, expect } from 'vitest';
import type { EvalExpectedFinding, EvalForbiddenRegion, Finding } from '@devdigest/shared';
import {
  computeCitationAccuracy,
  vacuouslyPerfect,
  computePrecision,
  computeRecall,
  deriveExpectationKind,
  foldBatchCost,
  groundingCountsFromOutcome,
  matchCase,
  scoreCase,
  scoreWithArm,
  scoreWithoutArm,
} from '../src/modules/evals/scoring.js';

/**
 * SPEC-03 §"Scoring" — the pure scorer (T4). No I/O; every case here is
 * plain-object in, plain-object out.
 */

let findingSeq = 0;
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  findingSeq += 1;
  return {
    id: `finding-${findingSeq}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'A finding',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'because',
    confidence: 0.8,
    ...overrides,
  };
}

function makeExpectation(overrides: Partial<EvalExpectedFinding> = {}): EvalExpectedFinding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'An expectation',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 10,
    ...overrides,
  };
}

function makeRegion(overrides: Partial<EvalForbiddenRegion> = {}): EvalForbiddenRegion {
  return { file: 'src/x.ts', start_line: 10, end_line: 10, ...overrides };
}

describe('evals scoring — matching + metrics', () => {
  it('REQ-21/22/23: metrics compute per the stated formulas; citation_accuracy reads the ReviewOutcome directly, no second groundFindings call', () => {
    const expectation = makeExpectation({ start_line: 5, end_line: 5 });
    const matched = makeFinding({ start_line: 5, end_line: 5 });
    const tally = matchCase({ expectedOutput: [expectation], forbiddenRegions: null, findings: [matched] });
    expect(tally).toEqual({ tp: 1, fn: 0, fp: 0 });
    expect(computeRecall(tally.tp, tally.fn)).toBe(1);
    expect(computePrecision(tally.tp, tally.fp)).toBe(1);

    // ReviewOutcome only ever carries `review.findings` (kept) and `dropped` —
    // there is no `kept` field. groundingCountsFromOutcome reads exactly those.
    const outcome = {
      review: { findings: [matched, makeFinding()], verdict: 'comment' as const, summary: '', score: 90 },
      dropped: [{ finding: makeFinding(), reason: 'out of range' }],
    };
    const counts = groundingCountsFromOutcome(outcome);
    expect(counts).toEqual({ kept: 2, dropped: 1 });
    expect(computeCitationAccuracy(counts.kept, counts.dropped)).toBeCloseTo(2 / 3);

    const withArm = scoreWithArm(
      { expectedOutput: [expectation], forbiddenRegions: null, findings: [matched] },
      outcome,
    );
    expect(withArm).toEqual({
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 2 / 3,
      tally: { tp: 1, fn: 0, fp: 0 },
    });
  });

  it('REQ-24: a secret_leak expectation matches on file equality with a non-intersecting range', () => {
    const expectation = makeExpectation({ file: 'src/secrets.ts', start_line: 1, end_line: 1 });
    const finding = makeFinding({
      file: 'src/secrets.ts',
      kind: 'secret_leak',
      start_line: 999,
      end_line: 999,
    });
    const tally = matchCase({ expectedOutput: [expectation], forbiddenRegions: null, findings: [finding] });
    expect(tally).toEqual({ tp: 1, fn: 0, fp: 0 });
  });

  it('REQ-25: each of the three metrics returns null, never 0, on a zero denominator', () => {
    expect(computeRecall(0, 0)).toBeNull();
    expect(computePrecision(0, 0)).toBeNull();
    expect(computeCitationAccuracy(0, 0)).toBeNull();
  });

  it('vacuouslyPerfect turns an undefined metric into 1 and leaves a measured one untouched', () => {
    // Owner decision, 2026-08-29. A unit that RAN and returned nothing said
    // nothing wrong and dropped nothing — that is a perfect score, not an
    // unmeasured one. Kept as a WRAPPER so the three compute functions above
    // still return null, which is what an errored case / all-errored batch
    // needs: "never ran" must not render as flawless.
    expect(vacuouslyPerfect(computePrecision(0, 0))).toBe(1);
    expect(vacuouslyPerfect(computeCitationAccuracy(0, 0))).toBe(1);
    expect(vacuouslyPerfect(0)).toBe(0); // a real zero is measured — never promoted to 1
    expect(vacuouslyPerfect(0.5)).toBe(0.5);
  });

  it('REQ-26: a must_find case returning the right finding plus two unrelated ones fails, TP=1, FP=2', () => {
    const expectation = makeExpectation({ start_line: 5, end_line: 5 });
    const right = makeFinding({ start_line: 5, end_line: 5 });
    const unrelatedA = makeFinding({ file: 'src/other-a.ts', start_line: 1, end_line: 1 });
    const unrelatedB = makeFinding({ file: 'src/other-b.ts', start_line: 2, end_line: 2 });
    const score = scoreCase({
      expectedOutput: [expectation],
      forbiddenRegions: null,
      findings: [right, unrelatedA, unrelatedB],
    });
    expect(score.tally).toEqual({ tp: 1, fn: 0, fp: 2 });
    expect(score.pass).toBe(false);
  });

  it('REQ-27: folding the same per-case costs in two different input orders yields the identical float, and all-null yields null', () => {
    const costs = [
      { caseId: 'case-c', costUsd: 0.3 },
      { caseId: 'case-a', costUsd: 0.1 },
      { caseId: 'case-b', costUsd: 0.2 },
    ];
    const reversed = [...costs].reverse();
    const shuffled = [costs[1]!, costs[2]!, costs[0]!];

    const total1 = foldBatchCost(costs);
    const total2 = foldBatchCost(reversed);
    const total3 = foldBatchCost(shuffled);
    expect(total1).toBe(total2);
    expect(total2).toBe(total3);
    expect(total1).toBeCloseTo(0.6);

    expect(
      foldBatchCost([
        { caseId: 'case-a', costUsd: null },
        { caseId: 'case-b', costUsd: null },
      ]),
    ).toBeNull();
  });

  it('REQ-43: expectation_kind is derived from expected_output emptiness by a function here', () => {
    expect(deriveExpectationKind([])).toBe('must_not_flag');
    expect(deriveExpectationKind([makeExpectation()])).toBe('must_find');
  });

  it('REQ-45: a forbidden-region case where the agent flags elsewhere in the same diff passes, finding is neither TP nor FP', () => {
    const region = makeRegion({ start_line: 10, end_line: 10 });
    const elsewhere = makeFinding({ start_line: 50, end_line: 50 });
    const score = scoreCase({ expectedOutput: [], forbiddenRegions: [region], findings: [elsewhere] });
    expect(score.tally).toEqual({ tp: 0, fn: 0, fp: 0 });
    expect(score.pass).toBe(true);
  });

  it('REQ-46: a region-less must_not_flag case counts every returned finding as FP', () => {
    const findingA = makeFinding({ start_line: 1, end_line: 1 });
    const findingB = makeFinding({ start_line: 2, end_line: 2 });
    const score = scoreCase({ expectedOutput: [], forbiddenRegions: null, findings: [findingA, findingB] });
    expect(score.tally).toEqual({ tp: 0, fn: 0, fp: 2 });
    expect(score.pass).toBe(false);

    const scoreEmptyArray = scoreCase({ expectedOutput: [], forbiddenRegions: [], findings: [findingA] });
    expect(scoreEmptyArray.tally.fp).toBe(1);
  });

  it('REQ-47: two overlapping expectations and one returned finding give recall = 0.5, not 1.0', () => {
    const expectationA = makeExpectation({ start_line: 1, end_line: 5 });
    const expectationB = makeExpectation({ start_line: 3, end_line: 8 });
    const finding = makeFinding({ start_line: 4, end_line: 4 });
    const tally = matchCase({
      expectedOutput: [expectationA, expectationB],
      forbiddenRegions: null,
      findings: [finding],
    });
    expect(tally).toEqual({ tp: 1, fn: 1, fp: 0 });
    expect(computeRecall(tally.tp, tally.fn)).toBe(0.5);
  });

  it('REQ-62/63: the scorer exposes a with-arm entry point returning all three metrics and a without-arm entry point returning recall only', () => {
    const expectation = makeExpectation({ start_line: 5, end_line: 5 });
    const finding = makeFinding({ start_line: 5, end_line: 5 });
    const input = { expectedOutput: [expectation], forbiddenRegions: null, findings: [finding] };
    const outcome = {
      review: { findings: [finding], verdict: 'comment' as const, summary: '', score: 90 },
      dropped: [],
    };

    const withArm = scoreWithArm(input, outcome);
    expect(Object.keys(withArm).sort()).toEqual(
      ['citationAccuracy', 'pass', 'precision', 'recall', 'tally'].sort(),
    );
    expect(withArm.recall).toBe(1);
    expect(withArm.precision).toBe(1);
    expect(withArm.citationAccuracy).toBe(1);

    const withoutArm = scoreWithoutArm(input);
    expect(Object.keys(withoutArm)).toEqual(['recall']);
    expect(withoutArm.recall).toBe(1);
  });
});
