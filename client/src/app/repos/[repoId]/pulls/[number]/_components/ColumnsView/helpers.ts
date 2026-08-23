/* ColumnsView/helpers.ts — the running/done/failed-per-agent live-status
   overlay, pulled out of ColumnsView.tsx's render body so it's testable
   without mounting React (mentor feedback on the L07 homework: no
   independently testable function existed for this derivation). Reuses
   `outcomeOf` (`@/lib/run-outcome`, already promoted out of `RunHistory` for
   exactly this "same badge in two places" reuse) — this file adds no new
   status logic, only the per-run review/findings join that `ColumnsView`
   used to do inline. */
import { outcomeOf, type Outcome } from "@/lib/run-outcome";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";

export interface LiveColumn {
  run: RunSummary;
  outcome: Outcome;
  /** `true` only once the run has reached its terminal "done" status — a
   *  running or failed agent's column never shows a cost badge or findings,
   *  even if a stale `review` row happens to exist for its `run_id`. */
  settled: boolean;
  review: ReviewRecord | undefined;
  findings: FindingRecord[];
}

/** One `LiveColumn` per run, in the same order as `runs`. `reviews` is
 *  joined by `run_id` (a Map lookup, not array position) — reviews and runs
 *  can and do arrive in different orders from `usePrRuns`/`usePrReviews`. */
export function deriveLiveColumns(runs: RunSummary[], reviews: ReviewRecord[]): LiveColumn[] {
  const reviewByRunId = new Map(reviews.filter((r) => r.run_id).map((r) => [r.run_id as string, r]));

  return runs.map((run) => {
    const review = reviewByRunId.get(run.run_id);
    return {
      run,
      outcome: outcomeOf(run),
      settled: run.status === "done",
      review,
      findings: review?.findings ?? [],
    };
  });
}
