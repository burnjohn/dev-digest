import { EVAL_BATCH_CONCURRENCY } from '@devdigest/shared';
import type { CompleteEvalBatch, EvalCaseRow, EvalsRepository } from '../repository.js';
import {
  computeCitationAccuracy,
  computePrecision,
  computeRecall,
  foldBatchCost,
  vacuouslyPerfect,
} from '../scoring.js';
import {
  runAgentCase,
  runSkillCase,
  type AgentRunConfig,
  type CaseRunnerDeps,
  type CaseRunResult,
  type SkillRunConfig,
} from './case-runner.js';

/**
 * T9 — the detached in-process batch loop for an agent-owned run (SPEC-03;
 * REQ-13's execution half, REQ-18, REQ-19, REQ-28, REQ-66-agent-side), with a
 * per-case `try/catch` so one case's failure never stops the rest.
 *
 * **Bounded concurrency, owner decision 2026-08-29 — this SUPERSEDES REQ-16's
 * "at most one `reviewPullRequest` in flight per batch".** The pool is capped
 * at `EVAL_BATCH_CONCURRENCY` (shared contract, so the studio can render the
 * same number of cases as live), never an unbounded `Promise.all` — the cost
 * is real money and the provider rate-limits. REQ-16's OTHER half still
 * holds: a skill case's two arms run one after the other, inside
 * `runSkillCase`, which this pool does not touch.
 *
 * T18 — `startSkillBatch` reuses the SAME loop (`runBatchLoop`) over
 * `runSkillCase` instead of `runAgentCase`: the concurrency bound and REQ-18's
 * terminal-status rule are ONE piece of logic, proven once by T9's own suite,
 * not reimplemented for the skill path.
 */

export interface BatchRunnerDeps extends CaseRunnerDeps {
  repo: Pick<EvalsRepository, 'insertBatch' | 'insertRun' | 'completeBatch'>;
}

/**
 * The already-summed inputs `foldBatchAggregate` folds — WITH-arm tallies only
 * (`result.tally`/`result.grounding` are `null` on an errored case and on the
 * without arm by construction, see `case-runner.ts`).
 */
export interface BatchAggregateInput {
  casesTotal: number;
  /** REQ-18: a case "produced a result" iff it did not error. */
  casesProduced: number;
  casesPassed: number;
  tp: number;
  fn: number;
  fp: number;
  kept: number;
  dropped: number;
  caseCosts: { caseId: string; costUsd: number | null }[];
}

/**
 * The terminal status + aggregate metrics of a completed set of cases.
 *
 * Pure, and deliberately shared by BOTH writers of an `eval_run_batches`
 * terminal row: `runBatchLoop` below, and `EvalsService.runCase`'s batch of 1.
 * A single-case run now feeds the same dashboard reads as a full set
 * (`getLatestTerminalBatch`, `getTrendBatches`), so the two MUST fold
 * identically — one function, not two implementations that agree today.
 *
 * REQ-18: succeeded iff every case produced a result, partial iff at least one
 * produced and at least one errored, failed iff none produced.
 *
 * FIX-1/REQ-29-30-32-33-34-37-71: metrics come from the summed raw TP/FN/FP and
 * kept/dropped via T4's `computeRecall`/`computePrecision`/
 * `computeCitationAccuracy` — never averaged from already-computed per-case
 * ratios, and never `0` on a zero denominator. A without-arm value never
 * reaches here (REQ-62).
 *
 * What a zero denominator yields changed with the vacuous-truth rule (owner
 * decision, 2026-08-29 — see `scoring.ts::vacuouslyPerfect`): all three fold
 * to **1** when at least one case produced a result, and to `null` only when
 * none did. Only a set where EVERY case is `must_not_flag` can hit that for
 * `recall`; one `must_find` case in the set and the sum has a real denominator
 * again, so a mixed set still reports its measured recall.
 */
export function foldBatchAggregate(input: BatchAggregateInput): CompleteEvalBatch {
  // The vacuous-truth rule's precondition at batch scale: at least one case
  // actually produced a result. A batch where every case errored keeps `null`
  // on all three — folding THAT to 1 would render a batch that never ran as
  // flawless.
  const produced = input.casesProduced > 0;
  return {
    status: input.casesProduced === input.casesTotal ? 'succeeded' : produced ? 'partial' : 'failed',
    casesPassed: input.casesPassed,
    casesTotal: input.casesTotal,
    // REQ-27 — sum of the non-null per-case costs in ascending `case_id` order.
    costUsd: foldBatchCost(input.caseCosts),
    recall: produced ? vacuouslyPerfect(computeRecall(input.tp, input.fn)) : null,
    precision: produced ? vacuouslyPerfect(computePrecision(input.tp, input.fp)) : null,
    citationAccuracy: produced
      ? vacuouslyPerfect(computeCitationAccuracy(input.kept, input.dropped))
      : null,
  };
}

export interface StartAgentBatchParams {
  workspaceId: string;
  /** The agent's id — `eval_run_batches.owner_id` for an agent-owned batch. */
  ownerId: string;
  /** The agent's `version` at the moment the batch starts (REQ-13). */
  ownerVersion: number;
  agent: AgentRunConfig;
  /** Already-loaded case rows — listing/filtering which cases belong to this
   * owner is the caller's concern (T13), not this pipeline's. */
  cases: EvalCaseRow[];
}

export interface StartAgentBatchResult {
  batchId: string;
  /**
   * Resolves once every case has been attempted and the terminal status +
   * aggregate write have landed. `startAgentBatch` itself resolves long
   * before this does (REQ-13) — a route built on it (T13) answers `202`
   * without ever awaiting `done`; a test awaits it to observe the finished
   * batch deterministically instead of polling.
   */
  done: Promise<void>;
}

/**
 * T18 — the skill-owned counterpart of `StartAgentBatchParams`. `runnerAgentId`
 * / `runnerAgentVersion` are the resolved runner agent (REQ-68 — the caller's,
 * i.e. T17's, concern), recorded on the batch row so a later comparison can
 * tell which agent's prompt/model produced a given skill batch.
 */
export interface StartSkillBatchParams {
  workspaceId: string;
  /** The skill's id — `eval_run_batches.owner_id` for a skill-owned batch. */
  ownerId: string;
  /** The skill's `version` at the moment the batch starts. */
  ownerVersion: number;
  /**
   * The resolved runner agent's id (REQ-68) — recorded on the batch row.
   * Nullable as of AC-68/T-C: a skill-owned batch no longer resolves a
   * runner agent, so this is `null` on that path (AC-69's historical rows
   * carry the same nullability).
   */
  runnerAgentId: string | null;
  /** The resolved runner agent's `version` at the moment the batch starts. `null` alongside `runnerAgentId`. */
  runnerAgentVersion: number | null;
  config: SkillRunConfig;
  cases: EvalCaseRow[];
}

export interface StartSkillBatchResult {
  batchId: string;
  /** Same contract as `StartAgentBatchResult.done`. */
  done: Promise<void>;
}

/**
 * REQ-13's execution half: persists the `eval_run_batches` row (`status:
 * 'running'`) FIRST, then hands the sequential per-case loop off to a
 * MACROTASK (`setImmediate`) rather than firing it inline — an inline
 * `void runBatchLoop(...)` still lets the loop's own microtask continuations
 * (each mock resolver's `await`, however "instant", is still at least one
 * microtask tick) win the race against the CALLER's `await` on this
 * function, so `MockLLMProvider.calls` can already be non-empty by the time
 * the caller resumes. A macrotask boundary is the one hand-off that is
 * ALWAYS strictly after every microtask already queued — including the
 * caller's own resumption — which is what "returns before the first case
 * completes" (REQ-13) actually requires.
 */
export async function startAgentBatch(
  deps: BatchRunnerDeps,
  params: StartAgentBatchParams,
): Promise<StartAgentBatchResult> {
  const batch = await deps.repo.insertBatch({
    workspaceId: params.workspaceId,
    ownerKind: 'agent',
    ownerId: params.ownerId,
    ownerVersion: params.ownerVersion,
    // The size of the set is known here, not only at completion — a client
    // polling this batch needs it as the denominator of its progress line.
    casesTotal: params.cases.length,
  });

  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  setImmediate(() => {
    runBatchLoop(deps, batch.id, params.workspaceId, params.cases, (evalCase) =>
      runAgentCase(deps, params.agent, evalCase),
    ).then(resolveDone, rejectDone);
  });

  return { batchId: batch.id, done };
}

/**
 * T18 — REQ-61 through REQ-67's execution half. Same `setImmediate` hand-off
 * as `startAgentBatch`, for the same reason (see its own doc comment); the
 * only difference is the row's `ownerKind`/`runnerAgentId`/`runnerAgentVersion`
 * and running `runSkillCase` (two arms, `runWithoutArm: true`) per case
 * instead of `runAgentCase` (one arm).
 */
export async function startSkillBatch(
  deps: BatchRunnerDeps,
  params: StartSkillBatchParams,
): Promise<StartSkillBatchResult> {
  const batch = await deps.repo.insertBatch({
    workspaceId: params.workspaceId,
    ownerKind: 'skill',
    ownerId: params.ownerId,
    ownerVersion: params.ownerVersion,
    runnerAgentId: params.runnerAgentId,
    runnerAgentVersion: params.runnerAgentVersion,
    casesTotal: params.cases.length,
  });

  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  setImmediate(() => {
    runBatchLoop(deps, batch.id, params.workspaceId, params.cases, (evalCase) =>
      // REQ-16: a batch always attempts the without arm — AC-50's
      // with-arm-only path is `EvalsService.runCase`'s single-case run, which
      // never goes through this loop at all.
      runSkillCase(deps, params.config, evalCase, { runWithoutArm: true }),
    ).then(resolveDone, rejectDone);
  });

  return { batchId: batch.id, done };
}

/**
 * The loop itself, shared by both owner kinds: a fixed pool of at most
 * `EVAL_BATCH_CONCURRENCY` workers pulling from one shared cursor, so no case
 * is ever run twice and the pool shrinks to the number of cases when the set
 * is smaller. A case that throws anywhere (including inside `runOneCase`,
 * though both `runAgentCase` and `runSkillCase` already turn their own known
 * failure modes into an `errored` result) is caught per case, so it counts as
 * errored rather than aborting the batch or killing its worker.
 *
 * The accumulators below are mutated from several workers. That is safe here
 * and only here: JS runs one turn at a time, and each `+=` is synchronous —
 * no `await` sits between a read and its write.
 */
async function runBatchLoop(
  deps: BatchRunnerDeps,
  batchId: string,
  workspaceId: string,
  cases: EvalCaseRow[],
  runOneCase: (evalCase: EvalCaseRow) => Promise<CaseRunResult>,
): Promise<void> {
  const casesTotal = cases.length;
  let casesPassed = 0;
  /** REQ-18: a case "produced a result" iff it did not error. */
  let casesProduced = 0;
  const caseCosts: { caseId: string; costUsd: number | null }[] = [];
  // FIX-1/REQ-29-30-32-33-34-37-71: raw TP/FN/FP + kept/dropped summed across
  // every case's WITH arm ONLY (`result.tally`/`result.grounding` are `null`
  // on an errored case and on the without arm by construction — see
  // `case-runner.ts`) — folded through `computeRecall`/`computePrecision`/
  // `computeCitationAccuracy` (T4) AFTER the loop, never averaged from
  // already-computed per-case ratios and never fed a without-arm value
  // (REQ-62).
  let tpSum = 0;
  let fnSum = 0;
  let fpSum = 0;
  let keptSum = 0;
  let droppedSum = 0;

  /** Shared cursor — the ONLY thing the workers coordinate on. */
  let nextIndex = 0;

  async function runOne(evalCase: EvalCaseRow): Promise<void> {
    try {
      const result = await runOneCase(evalCase);
      if (!result.errored) {
        casesProduced += 1;
        // REQ-62: `result.values.pass` is always the WITH arm's pass state
        // for a skill case (`runSkillCase` never derives it from the without
        // arm) — this aggregate reads the same field for both owner kinds.
        if (result.values.pass) casesPassed += 1;
        if (result.tally) {
          tpSum += result.tally.tp;
          fnSum += result.tally.fn;
          fpSum += result.tally.fp;
        }
        if (result.grounding) {
          keptSum += result.grounding.kept;
          droppedSum += result.grounding.dropped;
        }
      } else {
        // REQ-19: "recorded as errored with its reason". Neither `eval_runs`
        // nor `eval_run_batches` carries a reason column (T2's migration),
        // so — matching the existing convention for an unschema-backed
        // degradation (server/INSIGHTS.md, 2026-08-17, "a silent fail-open
        // hides a feature that never ran": `modules/` has no logger on any
        // `Deps`, so an off-convention `console.warn` beats an unobservable
        // pass) — the reason is logged, not silently dropped.
        console.warn(`eval batch ${batchId}: case ${evalCase.id} errored — ${result.errorReason}`);
      }
      caseCosts.push({ caseId: evalCase.id, costUsd: result.values.costUsd });
      await deps.repo.insertRun({
        caseId: evalCase.id,
        batchId,
        actualOutput: result.values.actualOutput,
        pass: result.values.pass,
        recall: result.values.recall,
        precision: result.values.precision,
        citationAccuracy: result.values.citationAccuracy,
        durationMs: result.values.durationMs,
        costUsd: result.values.costUsd,
      });
    } catch (err) {
      // Defensive: `runOneCase` already converts its own known failure modes
      // (zero/multi-file diff, missing provider key) into an `errored`
      // CaseRunResult rather than throwing. Anything else that escapes it
      // (an engine error `reviewPullRequest` itself threw — REQ-19's "the
      // with arm errors" row) still must not stop the batch — record it as
      // errored and move on.
      console.warn(`eval batch ${batchId}: case ${evalCase.id} errored — ${(err as Error).message}`);
      caseCosts.push({ caseId: evalCase.id, costUsd: null });
      await deps.repo
        .insertRun({
          caseId: evalCase.id,
          batchId,
          actualOutput: null,
          pass: null,
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs: 0,
          costUsd: null,
        })
        .catch(() => undefined);
    }
  }

  const workers = Array.from({ length: Math.min(EVAL_BATCH_CONCURRENCY, cases.length) }, async () => {
    for (;;) {
      const evalCase = cases[nextIndex++];
      if (!evalCase) return;
      await runOne(evalCase);
    }
  });
  await Promise.all(workers);

  // REQ-18 + FIX-1/REQ-29-30-32-33-34-37-71 — the status ladder and the
  // batch-level aggregate both live in `foldBatchAggregate` above, shared with
  // `EvalsService.runCase`'s batch of 1 so the two can never diverge.
  await deps.repo.completeBatch(
    workspaceId,
    batchId,
    foldBatchAggregate({
      casesTotal,
      casesProduced,
      casesPassed,
      tp: tpSum,
      fn: fnSum,
      fp: fpSum,
      kept: keptSum,
      dropped: droppedSum,
      caseCosts,
    }),
  );
}
