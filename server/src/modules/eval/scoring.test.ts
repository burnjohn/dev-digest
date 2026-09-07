import { describe, it, expect } from 'vitest';
import type { EvalCaseOutcome, EvalExpectation } from '@devdigest/shared';
import {
  matches,
  scoreCase,
  errorCaseOutcome,
  scoreRun,
  pairArms,
  computeLift,
  classifyEffects,
} from './scoring.js';

const mustFind: EvalExpectation = {
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
};

const mustNotFlag: EvalExpectation = {
  type: 'must_not_flag',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
};

function finding(overrides: Partial<{ file: string; start_line: number; end_line: number }> = {}) {
  return {
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    severity: 'WARNING',
    category: 'bug',
    title: 'x',
    ...overrides,
  };
}

describe('matches', () => {
  it('matches on same file and intersecting line range', () => {
    expect(matches(finding({ start_line: 11, end_line: 11 }), mustFind)).toBe(true);
  });

  it('does not match a different file', () => {
    expect(matches(finding({ file: 'src/b.ts' }), mustFind)).toBe(false);
  });

  it('does not match when ranges do not intersect', () => {
    expect(matches(finding({ start_line: 20, end_line: 21 }), mustFind)).toBe(false);
  });

  it('matches a wide finding overlapping the expectation by one line', () => {
    expect(matches(finding({ start_line: 1, end_line: 10 }), mustFind)).toBe(true);
  });

  // Mutation testing (server/LEARNINGS.md 2026-09-07) found this boundary
  // untested: the prior "wide finding" case above only exercises the overlap
  // landing on the FINDING'S end_line (its low end, since start_line < end_line
  // there). A finding whose overlap instead lands on its own start_line — i.e.
  // it starts exactly on the expectation's end_line and extends past it — hits
  // a different branch of `fLo`/`fHi`'s min/max normalization.
  it('matches a finding that starts exactly on the expectation end line and extends past it', () => {
    expect(matches(finding({ start_line: 12, end_line: 20 }), mustFind)).toBe(true);
  });
});

describe('scoreCase — AC-17', () => {
  it('must_find passes on >=1 matching finding', () => {
    const outcome = scoreCase({
      caseId: 'c1',
      name: 'case one',
      expectation: mustFind,
      findings: [finding({ start_line: 11, end_line: 11 })],
      groundingKept: 1,
      groundingTotal: 1,
      durationMs: 5,
      costUsd: 0.001,
    });
    expect(outcome.pass).toBe(true);
    expect(outcome.status).toBe('scored');
    expect(outcome.findings_matched).toBe(1);
  });

  it('must_find fails on zero matching findings', () => {
    const outcome = scoreCase({
      caseId: 'c1',
      name: 'case one',
      expectation: mustFind,
      findings: [finding({ start_line: 30, end_line: 30 })],
      groundingKept: 1,
      groundingTotal: 1,
      durationMs: 5,
      costUsd: null,
    });
    expect(outcome.pass).toBe(false);
  });

  it('must_not_flag passes on zero matching findings', () => {
    const outcome = scoreCase({
      caseId: 'c2',
      name: 'case two',
      expectation: mustNotFlag,
      findings: [],
      groundingKept: 0,
      groundingTotal: 0,
      durationMs: 1,
      costUsd: null,
    });
    expect(outcome.pass).toBe(true);
  });

  it('must_not_flag fails when a finding matches the forbidden range', () => {
    const outcome = scoreCase({
      caseId: 'c2',
      name: 'case two',
      expectation: mustNotFlag,
      findings: [finding({ start_line: 11, end_line: 11 })],
      groundingKept: 1,
      groundingTotal: 1,
      durationMs: 1,
      costUsd: null,
    });
    expect(outcome.pass).toBe(false);
  });
});

describe('errorCaseOutcome — AC-11', () => {
  it('is status errored, pass null, and contributes nothing to counts', () => {
    const outcome = errorCaseOutcome('c3', 'errored case', 'must_find', 'provider timeout', 42);
    expect(outcome.status).toBe('errored');
    expect(outcome.pass).toBeNull();
    expect(outcome.error_reason).toBe('provider timeout');
    expect(outcome.findings_total).toBe(0);
    expect(outcome.duration_ms).toBe(42);
  });
});

describe('scoreRun — AC-18 … AC-22', () => {
  it('AC-18 — recall = matched must_find / covered must_find', () => {
    const outcomes: EvalCaseOutcome[] = [
      scoreCase({
        caseId: '1',
        name: 'a',
        expectation: mustFind,
        findings: [finding({ start_line: 11, end_line: 11 })],
        groundingKept: 1,
        groundingTotal: 1,
        durationMs: 1,
        costUsd: 0,
      }),
      scoreCase({
        caseId: '2',
        name: 'b',
        expectation: mustFind,
        findings: [],
        groundingKept: 0,
        groundingTotal: 0,
        durationMs: 1,
        costUsd: 0,
      }),
    ];
    const run = scoreRun(outcomes, 100);
    expect(run.recall).toBe(0.5);
  });

  it('AC-19 — precision = 1 - FP/total over one must_not_flag case, 4 findings, 1 overlapping', () => {
    const outcome = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustNotFlag,
      findings: [
        finding({ start_line: 11, end_line: 11 }), // overlaps — FP
        finding({ start_line: 40, end_line: 40 }),
        finding({ start_line: 41, end_line: 41 }),
        finding({ start_line: 42, end_line: 42 }),
      ],
      groundingKept: 4,
      groundingTotal: 4,
      durationMs: 1,
      costUsd: 0,
    });
    const run = scoreRun([outcome], 100);
    expect(run.precision).toBe(0.75);
  });

  it('AC-20 — recall is not applicable (null) with no must_find cases', () => {
    const outcome = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustNotFlag,
      findings: [],
      groundingKept: 0,
      groundingTotal: 0,
      durationMs: 1,
      costUsd: 0,
    });
    const run = scoreRun([outcome], 100);
    expect(run.recall).toBeNull();
    expect(run.precision).toBeNull(); // zero findings at all
    expect(run.citation_accuracy).toBeNull(); // zero grounding denominator
  });

  it('AC-21 — citation_accuracy = kept/total from grounding numbers, not the summary string', () => {
    const outcome = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustFind,
      findings: [finding({ start_line: 11, end_line: 11 })],
      groundingKept: 3,
      groundingTotal: 4,
      durationMs: 1,
      costUsd: 0,
    });
    const run = scoreRun([outcome], 100);
    expect(run.citation_accuracy).toBe(0.75);
  });

  it('AC-22 — a grounding-dropped finding is never counted as a false positive (it never reaches `findings`)', () => {
    // The executor only ever passes GROUNDED (kept) findings into scoreCase —
    // this test asserts the scoring layer's contract: `findings_total` here
    // is exactly the kept set's size, independent of `grounding_total`.
    const outcome = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustNotFlag,
      findings: [finding({ start_line: 11, end_line: 11 })],
      groundingKept: 1,
      groundingTotal: 3, // 2 more findings were dropped by grounding upstream
      durationMs: 1,
      costUsd: 0,
    });
    expect(outcome.findings_total).toBe(1);
    const run = scoreRun([outcome], 100);
    expect(run.precision).toBe(0); // the one kept finding IS a false positive
  });

  it('AC-11 — an errored case is excluded from every numerator/denominator, and cases_errored is recorded', () => {
    const scored = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustFind,
      findings: [finding({ start_line: 11, end_line: 11 })],
      groundingKept: 1,
      groundingTotal: 1,
      durationMs: 1,
      costUsd: 0,
    });
    const errored = errorCaseOutcome('2', 'b', 'must_find', 'boom', 5);
    const run = scoreRun([scored, errored], 100);
    expect(run.recall).toBe(1); // only the scored must_find case counts
    expect(run.cases_errored).toBe(1);
    expect(run.traces_total).toBe(2);
    expect(run.traces_passed).toBe(1);
  });

  it('sums cost_usd across outcomes, null-propagating (map-reduce parity)', () => {
    const a = scoreCase({
      caseId: '1',
      name: 'a',
      expectation: mustFind,
      findings: [],
      groundingKept: 0,
      groundingTotal: 0,
      durationMs: 1,
      costUsd: 0.01,
    });
    const b = scoreCase({
      caseId: '2',
      name: 'b',
      expectation: mustFind,
      findings: [],
      groundingKept: 0,
      groundingTotal: 0,
      durationMs: 1,
      costUsd: null,
    });
    expect(scoreRun([a, b], 100).cost_usd).toBeNull();
    expect(scoreRun([a], 100).cost_usd).toBeCloseTo(0.01);
  });
});

// =============================================================================
// specs/15-skill-eval-cases.md §4 — the two-arm layer (AC-16, AC-20 … AC-23)
// =============================================================================

/** A `scored`, passing outcome — the shape `scoreCase` would have produced,
 *  built directly since these tests are about `pairArms`/`computeLift`/
 *  `classifyEffects`, not about `scoreCase` itself. */
function scoredOutcome(
  overrides: Partial<EvalCaseOutcome> & Pick<EvalCaseOutcome, 'case_id'>,
): EvalCaseOutcome {
  return {
    name: overrides.case_id,
    expectation_type: 'must_find',
    status: 'scored',
    pass: true,
    error_reason: null,
    findings_total: 1,
    findings_matched: 1,
    grounding_kept: 1,
    grounding_total: 1,
    duration_ms: 5,
    cost_usd: 0.001,
    actual: [],
    ...overrides,
  };
}

describe('pairArms — AC-23', () => {
  it('pairs two fully-scored, disjoint arms unchanged', () => {
    const withOutcomes = [scoredOutcome({ case_id: '1', pass: true })];
    const withoutOutcomes = [scoredOutcome({ case_id: '1', pass: false })];
    const { with: paired, without: pairedWithout } = pairArms(withOutcomes, withoutOutcomes);
    expect(paired).toEqual(withOutcomes);
    expect(pairedWithout).toEqual(withoutOutcomes);
  });

  it('a case errored in the WITH arm only is rewritten to errored in BOTH arrays, and counted once in cases_errored', () => {
    const withOutcomes = [
      errorCaseOutcome('1', 'a', 'must_find', 'boom', 3),
      scoredOutcome({ case_id: '2', pass: true }),
    ];
    const withoutOutcomes = [
      scoredOutcome({ case_id: '1', pass: false }),
      scoredOutcome({ case_id: '2', pass: false }),
    ];
    const { with: paired, without: pairedWithout } = pairArms(withOutcomes, withoutOutcomes);

    expect(paired[0]!.status).toBe('errored');
    expect(paired[0]!.error_reason).toBe('paired arm failed');
    expect(pairedWithout[0]!.status).toBe('errored');
    expect(pairedWithout[0]!.error_reason).toBe('paired arm failed');
    // The unaffected case (2) survives untouched in both arrays.
    expect(paired[1]).toEqual(withOutcomes[1]);
    expect(pairedWithout[1]).toEqual(withoutOutcomes[1]);

    // scoreRun's own cases_errored count reflects it exactly once per arm —
    // not twice, and not zero.
    expect(scoreRun(paired, 0).cases_errored).toBe(1);
    expect(scoreRun(pairedWithout, 0).cases_errored).toBe(1);
  });

  it('a case errored in the WITHOUT arm only is also excluded from BOTH — half a comparison is not a comparison', () => {
    const withOutcomes = [scoredOutcome({ case_id: '1', pass: true })];
    const withoutOutcomes = [errorCaseOutcome('1', 'a', 'must_find', 'timeout', 4)];
    const { with: paired, without: pairedWithout } = pairArms(withOutcomes, withoutOutcomes);

    expect(paired[0]!.status).toBe('errored');
    expect(paired[0]!.pass).toBeNull();
    expect(pairedWithout[0]!.status).toBe('errored');
    expect(pairedWithout[0]!.pass).toBeNull();
  });

  it('a case present in the WITH arm but entirely missing from the WITHOUT arm is also excluded from both (unpaired)', () => {
    const withOutcomes = [scoredOutcome({ case_id: '1', pass: true })];
    const withoutOutcomes: EvalCaseOutcome[] = [];
    const { with: paired, without: pairedWithout } = pairArms(withOutcomes, withoutOutcomes);

    expect(paired[0]!.status).toBe('errored');
    expect(pairedWithout[0]!.status).toBe('errored');
    expect(pairedWithout[0]!.duration_ms).toBe(0); // no real without-outcome to take a duration from
  });
});

describe('computeLift — AC-19, AC-22', () => {
  it('is the per-metric with-arm minus without-arm delta', () => {
    const withMetrics = scoreRun(
      [scoredOutcome({ case_id: '1', pass: true }), scoredOutcome({ case_id: '2', pass: true })],
      0,
    );
    const withoutMetrics = scoreRun(
      [scoredOutcome({ case_id: '1', pass: false }), scoredOutcome({ case_id: '2', pass: true })],
      0,
    );
    // recall: with = 2/2 = 1, without = 1/2 = 0.5 → lift 0.5
    const lift = computeLift(withMetrics, withoutMetrics);
    expect(lift.recall).toBeCloseTo(0.5);
  });

  it('AC-22 — recall lift is null (never 0) when a run has no must_find cases in EITHER arm', () => {
    const mustNotFlag = (id: string, pass: boolean) =>
      scoredOutcome({ case_id: id, expectation_type: 'must_not_flag', pass, findings_total: 0, findings_matched: 0 });
    const withMetrics = scoreRun([mustNotFlag('1', true)], 0);
    const withoutMetrics = scoreRun([mustNotFlag('1', true)], 0);
    expect(withMetrics.recall).toBeNull();
    expect(withoutMetrics.recall).toBeNull();
    const lift = computeLift(withMetrics, withoutMetrics);
    expect(lift.recall).toBeNull();
    expect(lift.recall).not.toBe(0);
  });

  it('is null when only ONE side is null (not both)', () => {
    const mustFind = scoreRun([scoredOutcome({ case_id: '1', pass: true })], 0);
    const mustNotFlagOnly = scoreRun(
      [scoredOutcome({ case_id: '1', expectation_type: 'must_not_flag', pass: true, findings_total: 0, findings_matched: 0 })],
      0,
    );
    expect(mustFind.recall).toBe(1);
    expect(mustNotFlagOnly.recall).toBeNull();
    expect(computeLift(mustFind, mustNotFlagOnly).recall).toBeNull();
    expect(computeLift(mustNotFlagOnly, mustFind).recall).toBeNull();
  });
});

describe('classifyEffects — D5, AC-20', () => {
  it('classifies all four values off each case’s pass/fail pair', () => {
    const pairedWith = [
      scoredOutcome({ case_id: 'helped', pass: true }),
      scoredOutcome({ case_id: 'hurt', pass: false }),
      scoredOutcome({ case_id: 'no_effect_pass', pass: true }),
      scoredOutcome({ case_id: 'no_effect_fail', pass: false }),
    ];
    const pairedWithout = [
      scoredOutcome({ case_id: 'helped', pass: false }),
      scoredOutcome({ case_id: 'hurt', pass: true }),
      scoredOutcome({ case_id: 'no_effect_pass', pass: true }),
      scoredOutcome({ case_id: 'no_effect_fail', pass: false }),
    ];
    const effects = classifyEffects(pairedWith, pairedWithout);
    const byId = new Map(effects.map((e) => [e.case_id, e.effect]));
    expect(byId.get('helped')).toBe('helped');
    expect(byId.get('hurt')).toBe('hurt');
    expect(byId.get('no_effect_pass')).toBe('no_effect_pass');
    expect(byId.get('no_effect_fail')).toBe('no_effect_fail');
    expect(effects).toHaveLength(4);
  });

  it('excludes an errored (unpaired) case entirely — never bucketed as no_effect_fail', () => {
    const errored = errorCaseOutcome('1', 'a', 'must_find', 'paired arm failed', 0);
    const pairedWith = [errored, scoredOutcome({ case_id: '2', pass: true })];
    const pairedWithout = [errored, scoredOutcome({ case_id: '2', pass: true })];
    const effects = classifyEffects(pairedWith, pairedWithout);
    expect(effects).toHaveLength(1);
    expect(effects[0]!.case_id).toBe('2');
    expect(effects.some((e) => e.case_id === '1')).toBe(false);
  });

  it('excludes a case present in the with-arm but absent from the without-arm', () => {
    const pairedWith = [scoredOutcome({ case_id: '1', pass: true })];
    const pairedWithout: EvalCaseOutcome[] = [];
    expect(classifyEffects(pairedWith, pairedWithout)).toHaveLength(0);
  });
});
