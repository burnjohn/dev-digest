import type { EvalExpectationKind, EvalExpectedFinding, EvalForbiddenRegion, Finding } from '@devdigest/shared';
import type { ReviewOutcome } from '@devdigest/reviewer-core';
import { FULL_FILE_KINDS } from './constants.js';
import type {
  CaseCost,
  CaseMatchInput,
  CaseScore,
  CaseTally,
  GroundingCounts,
  WithArmScore,
  WithoutArmScore,
} from './types.js';

/**
 * The pure eval scorer (SPEC-03 §"Scoring" — AC-21–AC-27, AC-43, AC-45–AC-47,
 * AC-62/AC-63). No I/O, no DB, no container, no model call: takes a case's
 * expectations plus the findings a run already produced and returns TP/FN/FP
 * tallies, the three headline metrics, per-case `pass`, and the batch cost
 * fold. Everything here is a function of its arguments alone.
 */

// ===========================================================================
// Region matching — O(1) per pair, never a walk over [start_line..end_line]
// ===========================================================================

/**
 * Two ranges overlap iff neither lies wholly before the other. This is a
 * constant-time compare, not a walk over the claimed line numbers — the same
 * defence `rangeIntersects` documents in `reviewer-core/src/grounding.ts:41-50`:
 * `start_line`/`end_line` come from untrusted model or case-author input, so a
 * saved expectation claiming `end_line: 1_000_000` must cost no more than one
 * that claims `end_line: 2`.
 */
function regionsIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * AC-24: a matched expectation whose finding carries a full-file `kind`
 * matches on `file` equality alone — mirroring `groundFindings`' own
 * full-file branch, not a new rule. Reads only `file`, `start_line`,
 * `end_line` and `kind` — never `severity`/`category`/`title`.
 */
function matchesExpectation(expectation: EvalExpectedFinding, finding: Finding): boolean {
  if (!expectation.file || expectation.file !== finding.file) return false;
  const isFullFile = finding.kind ? FULL_FILE_KINDS.has(finding.kind) : false;
  if (isFullFile) return true;
  return regionsIntersect(expectation.start_line, expectation.end_line, finding.start_line, finding.end_line);
}

/** AC-45: a forbidden region matches a finding on `file` equality plus range intersection. */
function matchesForbiddenRegion(region: EvalForbiddenRegion, finding: Finding): boolean {
  if (region.file !== finding.file) return false;
  return regionsIntersect(region.start_line, region.end_line, finding.start_line, finding.end_line);
}

// ===========================================================================
// expectation_kind — server-derived, never read from an input (AC-43)
// ===========================================================================

/** Derives `must_find` vs `must_not_flag` from `expected_output` emptiness alone. */
export function deriveExpectationKind(expectedOutput: EvalExpectedFinding[]): EvalExpectationKind {
  return expectedOutput.length === 0 ? 'must_not_flag' : 'must_find';
}

// ===========================================================================
// Matching — greedy, one-to-one, array order (AC-47)
// ===========================================================================

/**
 * Walks `expectedOutput` in order; for each, consumes the first unconsumed
 * `findings` entry that matches (AC-47) — no finding satisfies two
 * expectations. Every `findings` entry left unconsumed at the end is a false
 * positive (AC-22's definition: "findings in a `must_find` case that match no
 * expectation").
 */
function matchMustFind(expectedOutput: EvalExpectedFinding[], findings: Finding[]): CaseTally {
  const consumed = new Array<boolean>(findings.length).fill(false);
  let tp = 0;
  let fn = 0;

  for (const expectation of expectedOutput) {
    let matchedIndex = -1;
    for (let i = 0; i < findings.length; i++) {
      if (consumed[i]) continue;
      const finding = findings[i];
      if (finding && matchesExpectation(expectation, finding)) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) {
      fn++;
      continue;
    }
    consumed[matchedIndex] = true;
    tp++;
  }

  const fp = consumed.filter((wasConsumed) => !wasConsumed).length;
  return { tp, fn, fp };
}

/** AC-45/AC-46: a `must_not_flag` case has no expectations, so `tp`/`fn` are always 0. */
function matchMustNotFlag(forbiddenRegions: EvalForbiddenRegion[] | null, findings: Finding[]): CaseTally {
  if (!forbiddenRegions || forbiddenRegions.length === 0) {
    // AC-46: no regions declared → every returned finding is a false positive.
    return { tp: 0, fn: 0, fp: findings.length };
  }
  // AC-45: only a finding matching one of the declared regions counts; a
  // finding elsewhere in the same diff is neither TP nor FP.
  let fp = 0;
  for (const finding of findings) {
    if (forbiddenRegions.some((region) => matchesForbiddenRegion(region, finding))) fp++;
  }
  return { tp: 0, fn: 0, fp };
}

/** Tallies one case's TP/FN/FP — the shared definitions AC-21–AC-23 build on. */
export function matchCase(input: CaseMatchInput): CaseTally {
  return input.expectedOutput.length === 0
    ? matchMustNotFlag(input.forbiddenRegions, input.findings)
    : matchMustFind(input.expectedOutput, input.findings);
}

// ===========================================================================
// The three metrics — `null` on a zero denominator, never `0` (AC-25)
// ===========================================================================

export function computeRecall(tp: number, fn: number): number | null {
  const denominator = tp + fn;
  return denominator === 0 ? null : tp / denominator;
}

export function computePrecision(tp: number, fp: number): number | null {
  const denominator = tp + fp;
  return denominator === 0 ? null : tp / denominator;
}

export function computeCitationAccuracy(kept: number, dropped: number): number | null {
  const denominator = kept + dropped;
  return denominator === 0 ? null : kept / denominator;
}

/**
 * The VACUOUS-TRUTH rule — owner decision, 2026-08-29, and it SUPERSEDES
 * AC-25's blanket "null on a zero denominator" for two of the three metrics.
 *
 * A unit that RAN and returned no findings said nothing wrong and had nothing
 * dropped, so its precision and citation accuracy are **1** — a perfect score,
 * not an undefined one. Before this, a lone `must_not_flag` case (the common
 * shape: a "Safe: ..." case the reviewer correctly stays silent on) scored
 * `null` on both and the studio rendered an em dash, which reads as broken
 * rather than as the clean pass it actually is.
 *
 * Deliberately a WRAPPER, not a change to `computeRecall`/`computePrecision`/
 * `computeCitationAccuracy` themselves: `null` must still mean "unmeasured"
 * wherever no work was produced at all — an errored case, or an all-errored
 * batch (every case dead on a missing provider key). Folding those to 1 would
 * paint a batch that never ran as flawless, which is the one outcome worse
 * than a dash.
 *
 * **Applies to all THREE metrics** (owner decision, extended the same day).
 * Note what that means for recall specifically: `matchMustNotFlag` always
 * returns `tp = fn = 0`, so a `must_not_flag` case's recall denominator is
 * zero NO MATTER WHAT THE MODEL DOES — unlike precision, which still scores 0
 * when the model flags a forbidden region. Recall on such a case is therefore
 * a constant 1 that measures nothing; it is here for a uniform dashboard, not
 * because it discriminates. A MIXED set is unaffected either way:
 * `must_not_flag` cases add 0 to both sides of the sum, so a set containing
 * even one `must_find` case still reports its real, measured recall.
 */
export function vacuouslyPerfect(metric: number | null): number {
  return metric ?? 1;
}

/**
 * AC-23: read straight off the `ReviewOutcome` the engine already returned.
 * `run.ts:216` sets `review.findings = ground.kept` — there is no `kept`
 * field on `ReviewOutcome` to reach for, so `kept` is `review.findings.length`
 * and `dropped` is `dropped.length`. Never calls `groundFindings` again and
 * never parses the human-readable `outcome.grounding` string.
 */
export function groundingCountsFromOutcome(outcome: Pick<ReviewOutcome, 'review' | 'dropped'>): GroundingCounts {
  return { kept: outcome.review.findings.length, dropped: outcome.dropped.length };
}

// ===========================================================================
// Per-case pass + the two ablation entry points (AC-26, AC-62, AC-63)
// ===========================================================================

/** AC-26: `pass` iff every expectation matched (`fn === 0`) and zero FPs were attributed. */
export function scoreCase(input: CaseMatchInput): CaseScore {
  const tally = matchCase(input);
  const recall = computeRecall(tally.tp, tally.fn);
  const precision = computePrecision(tally.tp, tally.fp);
  const pass = tally.fn === 0 && tally.fp === 0;
  return { tally, pass, recall, precision };
}

/**
 * AC-62: the with arm alone determines a skill-owned case's `pass` and all
 * three metrics — no batch aggregate reads a value from the without arm. Also
 * the entry point for an agent-owned case, which only ever runs one arm.
 */
export function scoreWithArm(
  input: CaseMatchInput,
  outcome: Pick<ReviewOutcome, 'review' | 'dropped'>,
): WithArmScore {
  const { tally, pass } = scoreCase(input);
  const { kept, dropped } = groundingCountsFromOutcome(outcome);
  // Reached only on a case that PRODUCED a result — an errored case never gets
  // here (`case-runner.ts`'s `erroredResult` hard-codes nulls instead), which
  // is exactly the precondition `vacuouslyPerfect` requires.
  return {
    pass,
    recall: vacuouslyPerfect(computeRecall(tally.tp, tally.fn)),
    precision: vacuouslyPerfect(computePrecision(tally.tp, tally.fp)),
    citationAccuracy: vacuouslyPerfect(computeCitationAccuracy(kept, dropped)),
    tally,
  };
}

/** AC-63: the without arm computes recall only — never precision, never citation_accuracy.
 *  Called only on a without arm that PRODUCED an outcome (`case-runner.ts` builds
 *  `{ unavailable: 'errored' }` instead when it throws), so the vacuous-truth rule
 *  applies here too — otherwise a `must_not_flag` case would show a measured with-arm
 *  recall against a dashed without-arm one and the ablation delta would read as a
 *  regression the skill did not cause. */
export function scoreWithoutArm(input: CaseMatchInput): WithoutArmScore {
  const tally = matchCase(input);
  return { recall: vacuouslyPerfect(computeRecall(tally.tp, tally.fn)) };
}

// ===========================================================================
// Batch cost fold (AC-27)
// ===========================================================================

/**
 * Sums the non-null per-case costs, `null` iff every one is `null`. A float
 * fold is order-dependent (server/INSIGHTS.md, "client 2026-08-27"), so this
 * imposes AC-27's own order — ascending `case_id` — before folding, rather
 * than trusting the caller's array order.
 */
export function foldBatchCost(caseCosts: CaseCost[]): number | null {
  const ordered = [...caseCosts].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  let total: number | null = null;
  for (const { costUsd } of ordered) {
    if (costUsd == null) continue;
    total = (total ?? 0) + costUsd;
  }
  return total;
}
