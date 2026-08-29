/* lib/eval-batch.ts — how a RUNNING eval batch is rendered, shared by the two
   editors that can start one: the agent editor's Evals tab and the skill
   editor's. Promoted out of the agent tab's colocated `helpers.ts` when the
   skill tab grew the same progress line and per-case markers — a second
   consumer is the threshold, and the alternative (one feature folder reaching
   into another's `_components`) is an import-boundary breach.

   Everything here is a pure data transform: no JSX, no hooks, so it is
   asserted directly in `eval-batch.test.ts`. */
import { EVAL_BATCH_CONCURRENCY } from "@devdigest/shared";
import type { EvalBatchCaseResult, EvalBatchDetail, EvalBatchRecord } from "@devdigest/shared";

/** AC-17's progress fraction while a batch is running — the cases SCORED so
 * far over the size of the set. Empty string while there is no detail yet (the
 * caller composes it with the already-seeded `running` label, so this stays
 * free of copy).
 *
 * `fallbackTotal` (the number of cases on screen) covers a `cases_total` of
 * `0`: `eval_run_batches.cases_total` stayed NULL until the batch completed
 * and the wire mapping coalesces NULL to `0`, so a running batch rendered
 * `5/0` for its whole life. The server now writes the total at INSERT — this
 * fallback is what keeps a batch started before that fix readable. */
export function formatBatchFraction(
  detail: EvalBatchDetail | null | undefined,
  fallbackTotal = 0,
): string {
  if (!detail) return "";
  return `${detail.cases.length}/${detail.cases_total || fallbackTotal}`;
}

/** A batch counts as in-flight (non-terminal) only while `status ===
 * "running"` — `"succeeded"`/`"partial"`/`"failed"` all stop the 2s poll
 * (AC-17/AC-18) and free `Run all evals` back up. */
export function isBatchNonTerminal(status: EvalBatchRecord["status"] | undefined): boolean {
  return status === "running";
}

/** What a running BATCH is doing to one case right now: the single case in
 * flight, one still waiting its turn, or neither (already scored this batch,
 * or no batch running at all). */
export type BatchCaseState = "running" | "queued" | null;

/** Per-case batch state for the whole list, keyed by case id.
 *
 * The server runs a batch through a POOL of `EVAL_BATCH_CONCURRENCY` workers
 * (`evals/pipeline/batch-runner.ts` — bounded, never an unbounded
 * `Promise.all`: the cost is real money), over the cases in `listCases` order
 * — `name` asc, `id` asc, the SAME order this list renders. So: a case whose
 * id already appears in the detail's `cases` has been scored, the first
 * `EVAL_BATCH_CONCURRENCY` that have not are the ones in flight, and the rest
 * are waiting for a free worker. The concurrency number is imported, not
 * repeated: marking more cases "running" than the pool can hold would claim
 * LLM calls that are not happening.
 *
 * Membership drives "done", not position, so a server that returns its results
 * out of order still reads correctly; only WHICH of the remaining cases are
 * live depends on the shared order, and if that ever changed the display
 * degrades to "the first few pending", never to a wrong count. */
export function batchCaseStates(
  caseIds: readonly string[],
  detail: { cases: readonly Pick<EvalBatchCaseResult, "case_id">[] } | null | undefined,
  batchRunning: boolean,
): Map<string, Exclude<BatchCaseState, null>> {
  const states = new Map<string, Exclude<BatchCaseState, null>>();
  if (!batchRunning) return states;
  const scored = new Set(detail?.cases.map((c) => c.case_id) ?? []);
  let live = 0;
  for (const id of caseIds) {
    if (scored.has(id)) continue;
    states.set(id, live < EVAL_BATCH_CONCURRENCY ? "running" : "queued");
    live += 1;
  }
  return states;
}
