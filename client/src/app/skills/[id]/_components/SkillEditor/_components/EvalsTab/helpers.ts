/* helpers.ts — pure logic for the skill editor's EvalsTab. No JSX, no hooks:
   every function is a plain data transform so it can be asserted directly in
   helpers.test.ts without mounting a component.

   Deliberately a SIBLING of the agent tab's `helpers.ts`, not an import from
   it: one feature folder reaching into another's `_components` is an
   import-boundary breach, and the two arms genuinely disagree on the one
   function that matters — a skill run's findings live in the ABLATION object,
   never in `actual_output` (see `skillFindingCount`). What the two really
   share (`batchCaseStates`, `formatBatchFraction`, `isBatchNonTerminal`) is
   already promoted to `lib/eval-batch.ts`. */
import type { EvalCaseRunResult, EvalExpectationKind } from "@devdigest/shared";
import type { EvalCaseListItem } from "@/lib/hooks/evals";

/** AC-8/AC-9's marker: "pass"/"fail" for a case with a persisted run, "never"
 * when it has no `eval_runs` row at all — the caller renders a distinct
 * icon+aria for each and, per AC-9, renders NO pass/fail marker for "never". */
export type CaseRunMarker = "pass" | "fail" | "never";

export function caseRunMarker(item: EvalCaseListItem): CaseRunMarker {
  if (!item.latest_run) return "never";
  return item.latest_run.pass ? "pass" : "fail";
}

/** AC-8's `<m>` for a SKILL case. The agent arm reads `actual_output` (which
 * IS its findings array); a skill run persists `{with, without}` there
 * instead, so the count comes off the WITH arm — the only arm that determines
 * a skill case's `pass` and metrics (AC-62). A single-case run records no
 * without arm at all, which is why this never reads one. */
export function skillFindingCount(run: EvalCaseRunResult | null | undefined): number {
  return run?.ablation?.with.findings.length ?? 0;
}

/** The run's recall as a whole-number percent, or `null` when it recorded
 * none — a `must_not_flag` case has nothing to recall, so its line correctly
 * ends after `got <m>`. Copy-free so it can be asserted on its own. */
export function runRecallPercent(run: EvalCaseRunResult | null | undefined): number | null {
  if (run?.recall == null) return null;
  return Math.round(run.recall * 100);
}

/** The two ablation arms as whole-number percents — the row's `With skill X% /
 * Without skill Y%` suffix, and the skill tab's one piece of information the
 * agent tab has no equivalent for.
 *
 * `null` for the whole thing when the run carries no ablation (an agent-shaped
 * or pre-ablation run). `without: null` covers BOTH of AC-65's absences — a
 * single-case run never runs that arm (`{unavailable: "not_run"}`) and a
 * failed one reports `{unavailable: "errored"}` — as well as an arm that ran
 * and scored `recall: null`. The caller renders an em dash for it rather than
 * `0%`, which would libel the baseline as having found nothing when it was
 * never asked (AC-25's rule: `null` means unmeasured, never zero). */
export function ablationPercents(
  run: EvalCaseRunResult | null | undefined,
): { with: number | null; without: number | null } | null {
  const ablation = run?.ablation;
  if (!ablation) return null;
  const withoutArm = ablation.without;
  const withoutRecall = "unavailable" in withoutArm ? null : withoutArm.recall;
  return {
    with: toPercent(ablation.with.recall),
    without: toPercent(withoutRecall),
  };
}

function toPercent(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value * 100);
}

/** A case with no expectations has nothing to read a severity/category pair
 * from, so its row renders NO severity meta — the `MUST NOT FLAG` pill is what
 * identifies it (AC-46). */
export function isEmptyCase(item: EvalCaseListItem): boolean {
  return item.expected_output.length === 0;
}

/** AC-46/AC-48: which expectation the row's pill announces.
 *
 * `expectation_kind` is server-derived from `expected_output` emptiness alone
 * (AC-43, `evals/scoring.ts` `deriveExpectationKind`), so the two agree for
 * every case the current server writes. They can still diverge on a legacy row
 * whose `eval_cases.expectation_kind` column is NULL — the server defaults
 * that to `must_not_flag` regardless of the findings stored beside it. A
 * non-empty `expected_output` cannot mean anything but `must_find`, so it
 * wins, and the pill can never contradict the severity meta next to it. */
export function expectationKindOf(item: EvalCaseListItem): EvalExpectationKind {
  return isEmptyCase(item) ? item.expectation_kind : "must_find";
}

/** The `<n>/<m> passing` heading figure: `m` is every listed case, `n` the
 * subset whose most recent run passed — a case with no run, or a failed one,
 * is not counted, matching AC-26's `pass` definition. */
export function passingSummary(items: readonly EvalCaseListItem[]): { passed: number; total: number } {
  return { passed: items.filter((i) => i.latest_run?.pass === true).length, total: items.length };
}
