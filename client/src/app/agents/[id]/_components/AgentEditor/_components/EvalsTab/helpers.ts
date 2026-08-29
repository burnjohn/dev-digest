/* helpers.ts — pure logic for EvalsTab. No JSX, no hooks: every function here
   is a plain data transform so it can be asserted directly in
   helpers.test.ts without mounting a component. */
import type { EvalBatchRecord, EvalCaseRunResult, EvalExpectationKind } from "@devdigest/shared";
import type { EvalCaseListItem } from "@/lib/hooks/evals";

/** AC-8/AC-9's marker: "pass"/"fail" for a case with a persisted run, "never"
 * when it has no `eval_runs` row at all — the caller renders a distinct
 * icon+aria for each and, per AC-9, renders NO pass/fail marker for "never". */
export type CaseRunMarker = "pass" | "fail" | "never";

export function caseRunMarker(item: EvalCaseListItem): CaseRunMarker {
  if (!item.latest_run) return "never";
  return item.latest_run.pass ? "pass" : "fail";
}

/** AC-8: `<m>` is the count of findings in the run's `actual_output` — this
 * wave wires the agent arm only, where `actual_output` IS the findings array
 * itself (never the skill arm's `{with, without}` ablation object), so a
 * plain array-length read is correct here and would NOT be for a skill case. */
export function actualFindingCount(run: EvalCaseRunResult | null | undefined): number {
  return Array.isArray(run?.actual_output) ? run.actual_output.length : 0;
}

/** The run's recall as a whole-number percent for the row's result line, or
 * `null` when the run recorded none — a `must_not_flag` case has nothing to
 * recall, so its line correctly ends after `got <m>`. The caller composes this
 * with the `recallSuffix` copy; this stays free of copy so it can be asserted
 * on its own. */
export function runRecallPercent(run: EvalCaseRunResult | null | undefined): number | null {
  if (run?.recall == null) return null;
  return Math.round(run.recall * 100);
}

/** Formats a nullable 0..1 metric as a whole-number percent, or the
 * character `—` for an unmeasured metric (AC-25) — never `0%`. */
export function formatMetricPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** REQ-25/AC-30: the EVAL METRICS row's `TRACES PASSED <n>/<m>` figure — `—`
 * for an owner with no terminal batch yet, never `0/0`. */
export function formatTracesPassed(latestBatch: EvalBatchRecord | null | undefined): string {
  if (!latestBatch) return "—";
  return `${latestBatch.cases_passed}/${latestBatch.cases_total}`;
}

/** A case with no expectations at all has nothing to read a severity/category
 * pair from, so the row renders NO severity badge for it — the `MUST NOT FLAG`
 * pill is what identifies it (AC-46). */
export function isEmptyCase(item: EvalCaseListItem): boolean {
  return item.expected_output.length === 0;
}

/** AC-46/AC-48: which expectation the row's pill announces.
 *
 * `expectation_kind` is server-derived from `expected_output` emptiness alone
 * (AC-43, `evals/scoring.ts` `deriveExpectationKind`), so the two agree for
 * every case the current server writes. They can still diverge on a legacy row
 * whose `eval_cases.expectation_kind` column is NULL — `evals/helpers.ts`
 * defaults that to `must_not_flag` regardless of the findings stored beside it.
 * A non-empty `expected_output` cannot mean anything but `must_find`, so it
 * wins, and the pill can never contradict the severity badge next to it. */
export function expectationKindOf(item: EvalCaseListItem): EvalExpectationKind {
  return isEmptyCase(item) ? item.expectation_kind : "must_find";
}

/** `<n> / <m> passing` heading figure: `m` is every listed case, `n` is the
 * subset whose most recent run passed — a case with no run or a failed run
 * is not counted, matching AC-26's `pass` definition. */
export function passingSummary(items: readonly EvalCaseListItem[]): { passed: number; total: number } {
  return { passed: items.filter((i) => i.latest_run?.pass === true).length, total: items.length };
}



/** REQ-13: `Run all evals`'s disabled reason, or `null` when the action is
 * live. An empty case set takes priority over an in-flight batch so the
 * message always names the blocker that is actually true. */
export function runAllDisabledReason(
  caseCount: number,
  batchRunning: boolean,
  copy: { emptySetReason: string; inFlightReason: string },
): string | null {
  if (caseCount === 0) return copy.emptySetReason;
  if (batchRunning) return copy.inFlightReason;
  return null;
}
