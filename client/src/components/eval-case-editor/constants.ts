import type { EvalExpectationType } from "@devdigest/shared/contracts/knowledge";

/** Closed vocabulary for the expectation-type select in `CaseEditorPanel`
 *  (D3/AC-13 — a case's expectation type is always one of these two). */
export const EXPECTATION_TYPES: readonly EvalExpectationType[] = ["must_find", "must_not_flag"];

/** AC-32: compare is always exactly two runs — the run-history checkbox
 *  selection never allows a third. */
export const MAX_COMPARE_SELECTION = 2;
