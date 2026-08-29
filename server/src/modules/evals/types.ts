import type { EvalExpectedFinding, EvalForbiddenRegion, Finding } from '@devdigest/shared';

/**
 * Module-local shapes for the pure eval scorer (SPEC-03 §"Scoring"). These are
 * NOT wire contracts — `@devdigest/shared` (`contracts/eval-batch.ts`) stays
 * the source of truth for anything that crosses the API boundary. These exist
 * only to carry intermediate scoring state between the functions in
 * `scoring.ts`.
 */

/**
 * One case's matching inputs. `findings` is the run's GROUNDED output —
 * `outcome.review.findings` (`reviewer-core/src/review/run.ts:216` already
 * applied the citation gate; the scorer never re-runs `groundFindings`).
 *
 * `expectationKind` is deliberately absent: the scorer derives `must_find` vs
 * `must_not_flag` from `expectedOutput`'s own emptiness (AC-43) — never from a
 * caller-supplied value, so there is nothing here for one to drift from.
 */
export interface CaseMatchInput {
  expectedOutput: EvalExpectedFinding[];
  forbiddenRegions: EvalForbiddenRegion[] | null;
  findings: Finding[];
}

/** TP/FN/FP tally for one case, shared by both `must_find` and `must_not_flag` (AC-21–AC-23). */
export interface CaseTally {
  tp: number;
  fn: number;
  fp: number;
}

/** One case's matching outcome: the tally, its derived `pass`, recall and precision. */
export interface CaseScore {
  tally: CaseTally;
  pass: boolean;
  recall: number | null;
  precision: number | null;
}

/** `kept`/`dropped` as already carried by a `ReviewOutcome` (AC-23) — read, never recomputed. */
export interface GroundingCounts {
  kept: number;
  dropped: number;
}

/** AC-62: the with arm's full metric set plus the case's pass state. */
export interface WithArmScore {
  pass: boolean;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  tally: CaseTally;
}

/** AC-63: the without arm computes recall only — no precision, no citation_accuracy. */
export interface WithoutArmScore {
  recall: number | null;
}

/** One case's cost, as folded into a batch total (AC-27). `null` = unmeasured. */
export interface CaseCost {
  caseId: string;
  costUsd: number | null;
}
