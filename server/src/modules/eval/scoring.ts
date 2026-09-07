import type {
  EvalActualFinding,
  EvalCaseOutcome,
  EvalExpectation,
  EvalLift,
  EvalRun,
  EvalSkillCaseEffect,
} from '@devdigest/shared';

/**
 * specs/12-eval-pipeline.md — pure, zero-I/O, zero-LLM scoring (AC-16). This
 * file is the ENTIRE scoring surface: matching is file equality + line-range
 * intersection, computed in code (G4).
 */

/** The subset of a `Finding` scoring needs, structurally — no import of the
 *  full `Finding` contract needed for the match predicate itself. */
export interface ScoredFinding {
  file: string;
  start_line: number;
  end_line: number;
  severity: string;
  category: string;
  title: string;
}

/** AC-17 — a finding matches an expectation when file equality AND the two
 *  line ranges intersect (same rule the citation-grounding gate already
 *  applies to a diff hunk — this is the identical shape of comparison
 *  applied to an expectation instead). */
export function matches(finding: ScoredFinding, expectation: EvalExpectation): boolean {
  if (finding.file !== expectation.file) return false;
  const fLo = Math.min(finding.start_line, finding.end_line);
  const fHi = Math.max(finding.start_line, finding.end_line);
  const eLo = Math.min(expectation.start_line, expectation.end_line);
  const eHi = Math.max(expectation.start_line, expectation.end_line);
  return fLo <= eHi && eLo <= fHi;
}

export interface ScoreCaseInput {
  caseId: string;
  name: string;
  expectation: EvalExpectation;
  /** GROUNDED (kept) findings only — a dropped finding is never scored as a
   *  match (finding 6/AC-22). */
  findings: ScoredFinding[];
  groundingKept: number;
  groundingTotal: number;
  durationMs: number;
  costUsd: number | null;
}

/** AC-17 — `must_find` passes on >=1 matching finding; `must_not_flag`
 *  passes on ZERO matching findings. */
export function scoreCase(input: ScoreCaseInput): EvalCaseOutcome {
  const actual: EvalActualFinding[] = input.findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    matched: matches(f, input.expectation),
  }));
  const matchedCount = actual.filter((f) => f.matched).length;
  const pass = input.expectation.type === 'must_find' ? matchedCount > 0 : matchedCount === 0;

  return {
    case_id: input.caseId,
    name: input.name,
    expectation_type: input.expectation.type,
    status: 'scored',
    pass,
    error_reason: null,
    findings_total: input.findings.length,
    findings_matched: matchedCount,
    grounding_kept: input.groundingKept,
    grounding_total: input.groundingTotal,
    duration_ms: input.durationMs,
    cost_usd: input.costUsd,
    actual,
  };
}

/** AC-11 — a case whose execution threw becomes this shape: `pass: null`,
 *  excluded from every numerator/denominator `scoreRun` computes. */
export function errorCaseOutcome(
  caseId: string,
  name: string,
  expectationType: EvalExpectation['type'],
  reason: string,
  durationMs: number,
): EvalCaseOutcome {
  return {
    case_id: caseId,
    name,
    expectation_type: expectationType,
    status: 'errored',
    pass: null,
    error_reason: reason,
    findings_total: 0,
    findings_matched: 0,
    grounding_kept: 0,
    grounding_total: 0,
    duration_ms: durationMs,
    cost_usd: null,
    actual: [],
  };
}

function sumNullable(values: (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

/**
 * AC-18–AC-22 — set-level metrics over a run's outcomes. Errored cases
 * (AC-11) contribute to NEITHER numerator NOR denominator anywhere. Every
 * ratio is `null` (never 0/1) when its denominator is zero (AC-20).
 *
 * Precision is the SPEC'S LITERAL formula (`1 - FP/total`, resolved
 * clarification 8) — not textbook `TP/(TP+FP)`. FP = findings on
 * `must_not_flag` cases that matched that case's expectation; `total` = all
 * KEPT findings across the run (AC-19/AC-22).
 */
export function scoreRun(outcomes: EvalCaseOutcome[], durationMs: number): EvalRun {
  const scored = outcomes.filter((o) => o.status === 'scored');
  const casesErrored = outcomes.length - scored.length;

  const mustFind = scored.filter((o) => o.expectation_type === 'must_find');
  const recall = mustFind.length > 0 ? mustFind.filter((o) => o.pass).length / mustFind.length : null;

  const totalFindings = scored.reduce((n, o) => n + o.findings_total, 0);
  const falsePositives = scored
    .filter((o) => o.expectation_type === 'must_not_flag')
    .reduce((n, o) => n + o.findings_matched, 0);
  const precision = totalFindings > 0 ? 1 - falsePositives / totalFindings : null;

  const groundingKeptTotal = scored.reduce((n, o) => n + o.grounding_kept, 0);
  const groundingTotalTotal = scored.reduce((n, o) => n + o.grounding_total, 0);
  const citationAccuracy = groundingTotalTotal > 0 ? groundingKeptTotal / groundingTotalTotal : null;

  return {
    recall,
    precision,
    citation_accuracy: citationAccuracy,
    traces_passed: scored.filter((o) => o.pass).length,
    traces_total: outcomes.length,
    cases_errored: casesErrored,
    duration_ms: durationMs,
    cost_usd: sumNullable(outcomes.map((o) => o.cost_usd)),
    per_case: outcomes,
  };
}

// ===========================================================================
// specs/15-skill-eval-cases.md — the two-arm layer (D3/D4/D5). Pure, zero-I/O,
// zero-LLM, exactly like everything above. `matches`/`scoreCase`/
// `errorCaseOutcome`/`scoreRun` are UNCHANGED (D4/AC-17) — the with-arm's
// metrics are computed by the SAME `scoreRun` call an agent-owned run uses.
// ===========================================================================

const PAIRED_ARM_FAILED_REASON = 'paired arm failed';

/**
 * AC-23's real subtlety. `scoreRun` already drops `status === 'errored'` from
 * its OWN arm, but it cannot know that a case which scored in one arm errored
 * in the OTHER — such a case is half a comparison and must be excluded from
 * BOTH arms and from every lift, never scored as a `helped`/`hurt` on one
 * arm's data alone. Rewrites any case errored in EITHER arm into
 * `errorCaseOutcome(..., 'paired arm failed')` in BOTH returned arrays before
 * `scoreRun` runs on each — which is also what makes `cases_errored` (from
 * `scoreRun`'s own count) the number AC-23 asks the run to record.
 */
export function pairArms(
  withOutcomes: EvalCaseOutcome[],
  withoutOutcomes: EvalCaseOutcome[],
): { with: EvalCaseOutcome[]; without: EvalCaseOutcome[] } {
  const withoutByCaseId = new Map(withoutOutcomes.map((o) => [o.case_id, o]));
  const pairedWith: EvalCaseOutcome[] = [];
  const pairedWithout: EvalCaseOutcome[] = [];

  for (const withOutcome of withOutcomes) {
    const withoutOutcome = withoutByCaseId.get(withOutcome.case_id);
    const eitherErrored =
      withOutcome.status === 'errored' || !withoutOutcome || withoutOutcome.status === 'errored';
    if (eitherErrored) {
      pairedWith.push(
        errorCaseOutcome(
          withOutcome.case_id,
          withOutcome.name,
          withOutcome.expectation_type,
          PAIRED_ARM_FAILED_REASON,
          withOutcome.duration_ms,
        ),
      );
      pairedWithout.push(
        errorCaseOutcome(
          withOutcome.case_id,
          withOutcome.name,
          withOutcome.expectation_type,
          PAIRED_ARM_FAILED_REASON,
          withoutOutcome ? withoutOutcome.duration_ms : 0,
        ),
      );
    } else {
      pairedWith.push(withOutcome);
      pairedWithout.push(withoutOutcome);
    }
  }

  return { with: pairedWith, without: pairedWithout };
}

function liftOf(withValue: number | null, withoutValue: number | null): number | null {
  return withValue == null || withoutValue == null ? null : withValue - withoutValue;
}

/** D4/AC-19/AC-22 — per metric, with-arm minus without-arm, over the cases
 *  scored in both (i.e. computed from `pairArms`' output run through
 *  `scoreRun`). `null` (never 0) when either side is `null` — a lift over a
 *  metric with no denominator in either arm is not applicable. */
export function computeLift(withMetrics: EvalRun, withoutMetrics: EvalRun): EvalLift {
  return {
    recall: liftOf(withMetrics.recall, withoutMetrics.recall),
    precision: liftOf(withMetrics.precision, withoutMetrics.precision),
    citation_accuracy: liftOf(withMetrics.citation_accuracy, withoutMetrics.citation_accuracy),
  };
}

/**
 * D5 — the closed, deterministic four-value classification, derived from
 * each case's pass/fail in each (paired) arm: `!without && with → helped`;
 * `without && !with → hurt`; `with && without → no_effect_pass`;
 * `!with && !without → no_effect_fail`. Errored (hence unpaired, per
 * `pairArms`) cases are classified NOT AT ALL — absent from the returned
 * array, never bucketed as `no_effect_fail`.
 */
export function classifyEffects(
  pairedWith: EvalCaseOutcome[],
  pairedWithout: EvalCaseOutcome[],
): EvalSkillCaseEffect[] {
  const withoutByCaseId = new Map(pairedWithout.map((o) => [o.case_id, o]));
  const effects: EvalSkillCaseEffect[] = [];

  for (const withOutcome of pairedWith) {
    if (withOutcome.status !== 'scored' || withOutcome.pass === null) continue;
    const withoutOutcome = withoutByCaseId.get(withOutcome.case_id);
    if (!withoutOutcome || withoutOutcome.status !== 'scored' || withoutOutcome.pass === null) {
      continue;
    }
    const withPass = withOutcome.pass;
    const withoutPass = withoutOutcome.pass;
    const effect: EvalSkillCaseEffect['effect'] = withPass
      ? withoutPass
        ? 'no_effect_pass'
        : 'helped'
      : withoutPass
        ? 'hurt'
        : 'no_effect_fail';
    effects.push({ case_id: withOutcome.case_id, name: withOutcome.name, effect });
  }

  return effects;
}
