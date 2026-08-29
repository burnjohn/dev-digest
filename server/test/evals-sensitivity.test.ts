import { describe, it, expect } from 'vitest';
import type { EvalExpectedFinding, EvalForbiddenRegion, Finding } from '@devdigest/shared';
import type { EvalBatchRow } from '../src/db/rows.js';
import { computePrecision, matchCase } from '../src/modules/evals/scoring.js';
import { buildComparisonMetrics } from '../src/modules/evals/helpers.js';

/**
 * SPEC-03 AC-42 — the sensitivity experiment's MECHANISM half (T21). AC-42 itself cannot be
 * exercised end to end here: it needs a human to author two real case kinds, edit a live agent's
 * system prompt between two batches, and spend four real model calls (owner decision, spec §1.3,
 * "no gold set is seeded — seeding was considered and declined"). What CAN be pinned hermetically,
 * with zero real model calls, is the mechanism AC-42 depends on: that a `must_not_flag` violation
 * on the later batch strictly lowers `precision`, and that `buildComparisonMetrics` (T10) renders
 * that fall as a NEGATIVE signed delta rather than `null` or a signed zero.
 *
 * Route taken (see this task's report, "Notes for the integrator"): drive two batches' case-level
 * tallies through `scoring.ts` over literal `Finding[]` arrays standing in for what a mocked
 * provider returned each run (matching `evals-scoring.test.ts`'s own fixture style — no adapter,
 * no `MockLLMProvider`, no review engine invocation), fold each batch's tallies into one aggregate
 * precision via `computePrecision`, then feed two synthetic `EvalBatchRow` fixtures carrying those
 * precomputed numbers into `buildComparisonMetrics` — the exact shaping function REQ-71/AC-34
 * govern. This deliberately does NOT exercise `eval_run_batches.precision` being written by the
 * real batch pipeline (`batch-runner.ts`, not owned by this task and today never writes those
 * three columns per the correction in this task's dispatch) — pinning that bug would be pinning
 * the wrong mechanism.
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
    file: 'src/known-bug.ts',
    start_line: 20,
    end_line: 20,
    ...overrides,
  };
}

function makeRegion(overrides: Partial<EvalForbiddenRegion> = {}): EvalForbiddenRegion {
  return { file: 'src/secrets.ts', start_line: 40, end_line: 40, ...overrides };
}

let batchSeq = 0;
function makeBatch(overrides: Partial<EvalBatchRow> = {}): EvalBatchRow {
  batchSeq += 1;
  return {
    id: overrides.id ?? `batch-${String(batchSeq).padStart(3, '0')}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    ownerVersion: batchSeq,
    runnerAgentId: null,
    runnerAgentVersion: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    finishedAt: new Date('2026-01-01T00:05:00.000Z'),
    status: 'succeeded',
    recall: null,
    precision: null,
    citationAccuracy: null,
    casesPassed: null,
    casesTotal: 2,
    costUsd: 0.05,
    ...overrides,
  } as EvalBatchRow;
}

/**
 * The evals set fixed for both batches (AC-42's own scenario): one `must_find` case the earlier
 * batch already passes (the precondition's first half — without it `TP + FP = 0` on the earlier
 * batch and `precision` is `null` by AC-25), and one `must_not_flag` case whose forbidden region
 * the degraded prompt is instructed to violate (the precondition's second half).
 */
const mustFindExpectation = makeExpectation();
const forbiddenRegion = makeRegion();

/** Batch-level aggregate: sums each case's tally, then computes precision on the sum — the same
 * shape a batch aggregate would compute, without touching `batch-runner.ts`. */
function aggregatePrecision(caseFindings: { expectedOutput: EvalExpectedFinding[]; forbiddenRegions: EvalForbiddenRegion[] | null; findings: Finding[] }[]): number | null {
  let tp = 0;
  let fp = 0;
  for (const input of caseFindings) {
    const tally = matchCase(input);
    tp += tally.tp;
    fp += tally.fp;
  }
  return computePrecision(tp, fp);
}

describe('AC-42 mechanism — a must_not_flag violation strictly lowers precision and renders a negative delta', () => {
  it('earlier batch (prompt before the edit): must_find case passes, must_not_flag case stays clean — precision 1', () => {
    // Mocked provider output for batch 1: the must_find case is caught correctly...
    const mustFindCaseFindings = [makeFinding({ file: 'src/known-bug.ts', start_line: 20, end_line: 20 })];
    // ...and the must_not_flag case's forbidden region is left untouched by the (not yet edited) prompt.
    const mustNotFlagCaseFindings: Finding[] = [];

    const earlierPrecision = aggregatePrecision([
      { expectedOutput: [mustFindExpectation], forbiddenRegions: null, findings: mustFindCaseFindings },
      { expectedOutput: [], forbiddenRegions: [forbiddenRegion], findings: mustNotFlagCaseFindings },
    ]);

    expect(earlierPrecision).toBe(1);
  });

  it('later batch (prompt after the edit): the must_find case still passes, but the edited prompt now also flags inside the forbidden region — precision strictly lower, and the comparison shaping renders a negative signed delta', () => {
    // Same must_find case, same correct finding — the edit only widened what the agent reports,
    // it did not regress what it already caught.
    const mustFindCaseFindingsEarlier = [makeFinding({ file: 'src/known-bug.ts', start_line: 20, end_line: 20 })];
    const mustFindCaseFindingsLater = [makeFinding({ file: 'src/known-bug.ts', start_line: 20, end_line: 20 })];
    // The edited prompt instructs the agent to also report a class of finding the must_not_flag
    // case forbids — one EXTRA finding lands inside `forbiddenRegion` on the later batch only.
    const mustNotFlagCaseFindingsEarlier: Finding[] = [];
    const mustNotFlagCaseFindingsLater = [
      makeFinding({ file: forbiddenRegion.file, start_line: forbiddenRegion.start_line, end_line: forbiddenRegion.end_line }),
    ];

    const earlierPrecision = aggregatePrecision([
      { expectedOutput: [mustFindExpectation], forbiddenRegions: null, findings: mustFindCaseFindingsEarlier },
      { expectedOutput: [], forbiddenRegions: [forbiddenRegion], findings: mustNotFlagCaseFindingsEarlier },
    ]);
    const laterPrecision = aggregatePrecision([
      { expectedOutput: [mustFindExpectation], forbiddenRegions: null, findings: mustFindCaseFindingsLater },
      { expectedOutput: [], forbiddenRegions: [forbiddenRegion], findings: mustNotFlagCaseFindingsLater },
    ]);

    // The mechanism: TP stays 1 on both sides, FP goes 0 -> 1, so precision strictly falls.
    expect(earlierPrecision).toBe(1); // 1 / (1 + 0)
    expect(laterPrecision).toBe(0.5); // 1 / (1 + 1)
    expect(laterPrecision).toBeLessThan(earlierPrecision!);

    // The shaping: feed the two aggregate numbers into the SAME function AC-34's compare modal
    // reads (`buildComparisonMetrics`, T10) via two synthetic terminal EvalBatchRow fixtures.
    const older = makeBatch({ id: 'batch-before-edit', ownerVersion: 6, precision: earlierPrecision, recall: 1 });
    const newer = makeBatch({ id: 'batch-after-edit', ownerVersion: 7, precision: laterPrecision, recall: 1 });

    const comparison = buildComparisonMetrics(older, newer);

    expect(comparison.precision).toEqual({ old: 1, new: 0.5, delta: -0.5 });
    expect(comparison.precision.delta).not.toBeNull();
    expect(comparison.precision.delta!).toBeLessThan(0);
    // REQ-71 sanity check on the same call: a metric that is genuinely comparable on both sides
    // never renders as the `null` "uncomparable" case — that is a different code path this test
    // does not exercise, but the assertion above only holds if this one does too.
    expect(comparison.older.precision).toBe(1);
    expect(comparison.newer.precision).toBe(0.5);
  });

  it('the unfalsifiable case the precondition guards against: without the must_find case, the earlier batch is TP+FP=0, so precision is null and the delta is uncomparable, not negative', () => {
    // Same forbidden-region violation on the later batch, but NO must_find case in the set at all
    // — the precondition's first half is missing.
    const mustNotFlagOnly = [
      { expectedOutput: [], forbiddenRegions: [forbiddenRegion], findings: [] as Finding[] },
    ];
    const mustNotFlagOnlyLater = [
      {
        expectedOutput: [],
        forbiddenRegions: [forbiddenRegion],
        findings: [
          makeFinding({ file: forbiddenRegion.file, start_line: forbiddenRegion.start_line, end_line: forbiddenRegion.end_line }),
        ],
      },
    ];

    const earlierPrecision = aggregatePrecision(mustNotFlagOnly);
    const laterPrecision = aggregatePrecision(mustNotFlagOnlyLater);

    // AC-25: a zero TP+FP denominator is null, never 0.
    expect(earlierPrecision).toBeNull();
    expect(laterPrecision).toBe(0); // 0 / (0 + 1)

    const older = makeBatch({ id: 'batch-no-must-find-before', precision: earlierPrecision });
    const newer = makeBatch({ id: 'batch-no-must-find-after', precision: laterPrecision });
    const comparison = buildComparisonMetrics(older, newer);

    // REQ-71: null on either side is uncomparable — `—` (null), never a signed, negative delta.
    // This is the "unfalsifiable rather than failed" state the precondition exists to avoid.
    expect(comparison.precision.delta).toBeNull();
  });
});
