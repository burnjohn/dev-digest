/**
 * eval-scorer.ts — Pure eval-case scorer (Ring 2, D6, AC-8..AC-12, AC-14).
 *
 * A PURE function: no DB, no network, no LLM calls, no Container.
 * Takes (expected, emitted, diff) → { pass, recall, precision, citation_accuracy }.
 *
 * Reuse boundary: imports `groundFindings` from `@devdigest/reviewer-core`
 * (reviewer-core/src/index.ts:23) read-only — the scorer NEVER modifies reviewer-core.
 */

import type { UnifiedDiff } from '@devdigest/shared';
import type { Finding } from '@devdigest/shared';
import { groundFindings } from '@devdigest/reviewer-core';
import { EvalExpectedOutput } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Range intersection (AC-8)
//
// An expected finding is MATCHED iff some emitted finding has the SAME `file`
// AND its [start_line..end_line] INTERSECTS the expected range (inclusive).
//
// This is the verbatim semantics of `rangeIntersects` in
//   reviewer-core/src/grounding.ts:41-46
// (source of truth for the grounding gate's intersection rule).
// We keep a tiny local copy here — with this comment — rather than exporting
// a new symbol from reviewer-core, to avoid widening that package's surface.
// ---------------------------------------------------------------------------

/**
 * Returns true iff the integer range [aLo..aHi] overlaps [bLo..bHi] (inclusive).
 *
 * Semantics copied verbatim from reviewer-core/src/grounding.ts:41-46.
 */
function rangeIntersects(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  // Two ranges overlap iff neither ends before the other starts.
  return aLo <= bHi && bLo <= aHi;
}

// ---------------------------------------------------------------------------
// Per-case scoring result
// ---------------------------------------------------------------------------

export interface ScoredCase {
  /** Whether the case passed. */
  pass: boolean;
  /** Fraction of expected must_find findings matched; 1 when zero expected (AC-9). */
  recall: number;
  /** Fraction of emitted findings that are not false positives; 1 when zero emitted (AC-10). */
  precision: number;
  /** Fraction of emitted findings surviving groundFindings vs the diff; 1 when zero emitted (AC-12). */
  citation_accuracy: number;
  /** Skipped/failed because expectedOutput could not be parsed. */
  skipped?: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// scoreCase — the main entry point (AC-8..AC-12, AC-14)
// ---------------------------------------------------------------------------

/**
 * Score a single eval case.
 *
 * Pure function of (expected, emitted, diff) — no Date.now, no random,
 * no map-ordering dependence (AC-14). Identical inputs → byte-identical output.
 *
 * If `rawExpected` fails EvalExpectedOutput.safeParse, the case is marked
 * skipped rather than throwing — the run loop (T6) never fails the whole batch.
 *
 * @param rawExpected  The value stored in the eval_cases.expected_output jsonb.
 * @param emitted      The findings the agent emitted for this case's input.
 * @param diff         The frozen diff for this case (from stored input_diff text).
 */
export function scoreCase(
  rawExpected: unknown,
  emitted: Finding[],
  diff: UnifiedDiff,
): ScoredCase {
  // --- Parse & validate expected output (malformed case → skipped, AC-3 / edge-case) ---
  const parsed = EvalExpectedOutput.safeParse(rawExpected);
  if (!parsed.success) {
    return {
      pass: false,
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      skipped: true,
      skipReason: `EvalExpectedOutput parse error: ${parsed.error.message}`,
    };
  }
  const expected = parsed.data;

  // --- citation_accuracy (AC-12): fraction of emitted surviving groundFindings ---
  //
  // Reuse the gate (reviewer-core/src/index.ts:23); do not reimplement.
  const citationAccuracy = computeCitationAccuracy(emitted, diff);

  if (expected.type === 'must_find') {
    // --- recall (AC-9): matched / total expected; zero expected → 1 ---
    const { recall, matchedCount } = computeRecall(expected.findings, emitted);
    // A must_find case passes iff every expected finding is matched (full recall).
    const pass = expected.findings.length === 0 || matchedCount === expected.findings.length;
    // precision: for must_find cases there are no designated false-positive stressors.
    // A must_find case contributes no false positives to precision by itself.
    // All emitted findings count as non-false-positive for this case type.
    const precision = emitted.length === 0 ? 1 : 1;

    return { pass, recall, precision, citation_accuracy: citationAccuracy };
  }

  // expected.type === 'must_not_flag'
  // --- precision (AC-10): a must_not_flag case's forbidden target being intersected = FP ---
  const { precision, fpCount } = computePrecision(expected.forbidden, emitted);
  // recall for must_not_flag: no must_find findings → vacuously 1 (AC-9).
  const recall = 1;
  // Passes iff no false positives were emitted (none of the forbidden targets hit).
  const pass = fpCount === 0;

  return { pass, recall, precision, citation_accuracy: citationAccuracy };
}

// ---------------------------------------------------------------------------
// scoreRun — aggregates per-case scores into run-level metrics
// ---------------------------------------------------------------------------

export interface RunScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  /** Number of cases that passed (for traces_passed). */
  casesPassed: number;
  casesTotal: number;
  /** Overall pass: true iff all non-skipped cases pass. */
  pass: boolean;
}

/**
 * Aggregate per-case ScoredCase results into run-level metrics.
 *
 * Averages recall/precision/citation_accuracy across non-skipped cases.
 * Zero cases → all metrics are 1 (vacuous, AC-9/10/12).
 */
export function scoreRun(cases: ScoredCase[]): RunScore {
  const nonSkipped = cases.filter((c) => !c.skipped);
  const total = nonSkipped.length;

  if (total === 0) {
    return { recall: 1, precision: 1, citation_accuracy: 1, casesPassed: 0, casesTotal: 0, pass: true };
  }

  let recallSum = 0;
  let precisionSum = 0;
  let citationSum = 0;
  let passed = 0;

  for (const c of nonSkipped) {
    recallSum += c.recall;
    precisionSum += c.precision;
    citationSum += c.citation_accuracy;
    if (c.pass) passed++;
  }

  return {
    recall: recallSum / total,
    precision: precisionSum / total,
    citation_accuracy: citationSum / total,
    casesPassed: passed,
    casesTotal: total,
    pass: passed === total,
  };
}

// ---------------------------------------------------------------------------
// Helpers — kept pure, no side effects
// ---------------------------------------------------------------------------

/**
 * Compute citation_accuracy: fraction of emitted findings surviving groundFindings.
 * Zero emitted → 1 (AC-12 vacuous rule).
 */
function computeCitationAccuracy(emitted: Finding[], diff: UnifiedDiff): number {
  if (emitted.length === 0) return 1;
  // Delegate to the grounding gate — do not reimplement the citation check.
  const result = groundFindings(emitted, diff);
  return result.kept.length / emitted.length;
}

/**
 * Compute recall for a must_find case.
 * An expected finding is MATCHED iff some emitted finding has the same `file`
 * AND its [start_line..end_line] intersects the expected range (AC-8).
 * Zero expected findings → recall = 1 (AC-9 vacuous rule).
 */
function computeRecall(
  expectedFindings: Finding[],
  emitted: Finding[],
): { recall: number; matchedCount: number } {
  if (expectedFindings.length === 0) return { recall: 1, matchedCount: 0 };

  let matched = 0;
  for (const exp of expectedFindings) {
    const isMatched = emitted.some(
      (em) =>
        em.file === exp.file &&
        rangeIntersects(em.start_line, em.end_line, exp.start_line, exp.end_line),
    );
    if (isMatched) matched++;
  }

  return { recall: matched / expectedFindings.length, matchedCount: matched };
}

/**
 * Compute precision for a must_not_flag case.
 * A forbidden target being intersected by an emitted finding = false positive.
 * Zero emitted → precision = 1 (AC-10 vacuous rule).
 *
 * precision = (emitted.length - fpCount) / emitted.length
 */
function computePrecision(
  forbidden: Array<{ file: string; start_line: number; end_line: number }>,
  emitted: Finding[],
): { precision: number; fpCount: number } {
  if (emitted.length === 0) return { precision: 1, fpCount: 0 };

  let fpCount = 0;
  for (const em of emitted) {
    const isFp = forbidden.some(
      (f) =>
        em.file === f.file &&
        rangeIntersects(em.start_line, em.end_line, f.start_line, f.end_line),
    );
    if (isFp) fpCount++;
  }

  return {
    precision: (emitted.length - fpCount) / emitted.length,
    fpCount,
  };
}
