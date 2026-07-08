import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type {
  EvalAgentSummary,
  EvalBatchCompareResult,
  EvalBatchDetail,
  EvalCaseCreateInput,
  EvalCaseListItem,
  EvalRecentBatchRow,
  EvalRunAllResult,
  EvalTrendPointV2,
  Expectation,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { EvalRepository } from './repository.js';
import { EvalRunOrchestrator, type Logger } from './run-orchestrator.js';
import { computeFlakedStatus, scoreCase } from './scoring.js';
import { batchCaseOutcome, batchDetailDto, batchDto, caseListItem, expectationsFromJson, trendPoint } from './helpers.js';

/** Recent-batches feed row cap (Step 4 / AC-9) — server-fixed, never
 *  client-supplied and never unbounded. */
const RECENT_BATCHES_CAP = 25;

/** Sparkline point count per agent card (Step 4) — deliberately small; the
 *  full trend history is a separate, agent-scoped read (`getTrend`). */
const SPARKLINE_POINTS_CAP = 8;

/**
 * EvalService — case CRUD + read-side batch/trend/compare composition. Batch
 * *execution* lives in `EvalRunOrchestrator` (kept separate to stay under the
 * ~300-line sub-plugin threshold documented in `server/insights.md`).
 *
 * Cross-module reads (a finding's file/line/severity/PR diff) go through
 * `container.reviewRepo` — the container's already-exposed cross-cutting
 * repository facade (see `platform/container.ts`'s `reviewRepo` getter) —
 * never a direct `reviews/repository.js` import (module isolation, R6).
 */
export class EvalService {
  private repo: EvalRepository;
  private orchestrator: EvalRunOrchestrator;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.orchestrator = new EvalRunOrchestrator(container);
  }

  // -------------------------------------------------------------- case CRUD

  /**
   * Agent-owned case list + the visible count of workspace skill-owned cases
   * excluded from it (AC-2 — never silently dropped). `last_run_status` folds
   * in the flaked check (AC-27): flaked takes precedence over a plain
   * pass/fail label whenever the last-3-full-batches sequence flipped.
   */
  async listCases(
    workspaceId: string,
    agentId: string,
  ): Promise<{ cases: EvalCaseListItem[]; excluded_skill_owned_count: number }> {
    const [rows, excludedSkillOwnedCount] = await Promise.all([
      this.repo.listCases(workspaceId, agentId),
      this.repo.countSkillOwnedCases(workspaceId),
    ]);

    const cases = await Promise.all(
      rows.map(async (row) => {
        const latestRun = await this.repo.latestRunForCase(row.id);
        const lastThree = await this.repo.lastThreeFullBatchOutcomesForCase(row.id, agentId);
        const flaked = computeFlakedStatus(lastThree);
        return caseListItem(row, latestRun, flaked);
      }),
    );

    return { cases, excluded_skill_owned_count: excludedSkillOwnedCount };
  }

  /**
   * Promote an already-accepted/dismissed finding into an eval case (AC-1,
   * AC-3–AC-6). Created immediately — no confirmation step.
   *
   * Derivation:
   *  - expectation type: `must_find` when accepted, `must_not_flag` when
   *    dismissed; neither → the finding hasn't been triaged yet (validation error).
   *  - file/line_start/line_end copied from the finding row; severity/kind
   *    copied as display metadata only (never read by scoring — AC-24).
   *  - diff fragment: `parseUnifiedDiff(prDiff.raw)`'s hunks filtered to the
   *    finding's file ONLY (AC-5 — not the whole PR diff), re-serialized to a
   *    minimal unified-diff string containing just that file's hunk(s).
   *
   * Idempotent by `inputMeta.source_finding_id` (#12): repeat calls for the
   * SAME finding (e.g. double-clicks, revisits) return the existing case
   * instead of inserting a duplicate that would double-weight aggregates.
   *
   * Gated on the diff fragment resolving to at least one file (#8), the same
   * rule `createCaseManual`/`updateCase` enforce — a patchless file (large/
   * binary diff, or a rename `pr_files` doesn't carry a patch for) would
   * otherwise silently persist an empty `inputDiff`, permanently failing (if
   * accepted) or vacuously passing (if dismissed) every future run.
   */
  async createCaseFromFinding(workspaceId: string, findingId: string) {
    const existingCase = await this.repo.findCaseBySourceFindingId(workspaceId, findingId);
    if (existingCase) {
      return caseListItem(existingCase, null, false);
    }

    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    let expectationType: Expectation['type'];
    if (finding.acceptedAt) {
      expectationType = 'must_find';
    } else if (finding.dismissedAt) {
      expectationType = 'must_not_flag';
    } else {
      throw new ValidationError('Finding must be accepted or dismissed first');
    }

    const agentId = review.agentId;
    if (!agentId) throw new ValidationError('Finding has no owning agent');

    const expectation: Expectation = {
      type: expectationType,
      file: finding.file,
      line_start: finding.startLine,
      line_end: finding.endLine,
      severity: finding.severity,
      category: finding.category,
      kind: finding.kind,
    };

    // Reconstruct the PR's unified diff from persisted pr_files patches (same
    // reconstruction shape as `reviews/diff-loader.ts`'s pr_files fallback),
    // then keep ONLY the finding's file (AC-5).
    const prFiles = await this.container.reviewRepo.getPrFiles(pull.id);
    const parts: string[] = [];
    for (const f of prFiles) {
      if (!f.patch) continue;
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
      parts.push(f.patch);
    }
    const fullDiff = parseUnifiedDiff(parts.join('\n'));
    const fileDiff = fullDiff.files.find((f) => f.path === finding.file);
    const inputDiff = fileDiff
      ? [`diff --git a/${fileDiff.path} b/${fileDiff.path}`, `--- a/${fileDiff.path}`, `+++ b/${fileDiff.path}`, prFiles.find((f) => f.path === finding.file)?.patch ?? ''].join('\n')
      : '';

    if (!fileDiff) {
      throw new ValidationError('No diff available for this file — cannot create an eval case from this finding');
    }

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: finding.title,
      inputDiff,
      inputMeta: {
        source: 'finding',
        source_finding_id: findingId,
        source_pr_number: pull.number,
      },
      expectedOutput: [expectation],
      notes: finding.rationale,
    });

    return caseListItem(row, null, false);
  }

  /** Hand-authored case (AC-7/AC-8): the diff fragment must parse to at least
   *  one file, or the save fails without persisting anything. */
  async createCaseManual(workspaceId: string, agentId: string, input: EvalCaseCreateInput) {
    const parsed = parseUnifiedDiff(input.input_diff);
    if (parsed.files.length === 0) {
      throw new ValidationError('Diff fragment must reference at least one file');
    }

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      inputMeta: { source: 'manual' },
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });

    return caseListItem(row, null, false);
  }

  /**
   * Full-replacement edit of a hand-authored or finding-sourced case (AC-7/
   * AC-8 apply identically to edits): the diff fragment must parse to at
   * least one file, or the save fails without persisting anything. `source`/
   * `inputMeta` (provenance) are preserved as-is — an edit never overwrites
   * where the case came from.
   */
  async updateCase(
    workspaceId: string,
    agentId: string,
    caseId: string,
    input: EvalCaseCreateInput,
  ) {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing || existing.ownerId !== agentId) {
      throw new NotFoundError('Eval case not found');
    }

    const parsed = parseUnifiedDiff(input.input_diff);
    if (parsed.files.length === 0) {
      throw new ValidationError('Diff fragment must reference at least one file');
    }

    const row = await this.repo.updateCase(workspaceId, caseId, {
      name: input.name,
      inputDiff: input.input_diff,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    if (!row) throw new NotFoundError('Eval case not found');

    return caseListItem(row, null, false);
  }

  /**
   * Existence/ownership check, then delete. Confirmation is client-side
   * (AC-10). Ownership is enforced identically to `updateCase` (#2): the
   * case must be agent-owned AND owned by THIS agent, or the delete is
   * rejected as not-found — otherwise a same-workspace DELETE via any
   * agent's URL could destroy another agent's (or a skill-owned) case, and
   * cascade-wipe its run history out of sealed batches.
   */
  async deleteCase(workspaceId: string, agentId: string, caseId: string): Promise<void> {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing || existing.ownerKind !== 'agent' || existing.ownerId !== agentId) {
      throw new NotFoundError('Eval case not found');
    }
    await this.repo.deleteCase(workspaceId, caseId);
  }

  // ------------------------------------------------------------------- runs

  /**
   * Start a batch run (#9 — 202 flow): resolves the run target and inserts
   * the batch row synchronously, then returns immediately WITHOUT awaiting
   * the case fan-out. The caller (route handler) is responsible for kicking
   * off `executeBatch` detached (with a `req.log.child({...})` taken BEFORE
   * responding) and must not await it — see `EvalRunOrchestrator.executeBatch`'s
   * doc comment for the full rationale.
   */
  async startEvalRun(workspaceId: string, agentId: string, caseIds?: string[]) {
    return this.orchestrator.startBatch(workspaceId, agentId, caseIds);
  }

  /** Fan out + seal a batch already started via `startEvalRun` — detached, see above. */
  async executeEvalRun(
    started: Awaited<ReturnType<EvalRunOrchestrator['startBatch']>>,
    log?: Parameters<EvalRunOrchestrator['executeBatch']>[4],
  ): Promise<{ status: 'clean' | 'degraded' | null }> {
    return this.orchestrator.executeBatch(started.batch, started.agent, started.skillBodies, started.targetCases, log);
  }

  /**
   * Synchronous start+run+seal in one call (used by tests / any caller that
   * genuinely wants to await the full fan-out). Routes must use
   * `startEvalRun` + detached `executeEvalRun` instead (AC-9).
   */
  async runBatch(workspaceId: string, agentId: string, caseIds?: string[]) {
    return this.orchestrator.runBatch(workspaceId, agentId, caseIds);
  }

  // -------------------------------------------------------------- read-side

  async listBatchHistory(workspaceId: string, agentId: string) {
    const rows = await this.repo.listBatchHistory(workspaceId, agentId);
    return rows.map(batchDto);
  }

  /**
   * Batch drill-down (AC-33). Per-case matched/expected counts are read from
   * the `eval_runs` row AS PERSISTED AT RUN TIME (#4) — NOT re-scored against
   * the case's CURRENT `expected_output`. Re-scoring at read time meant
   * editing a case after a run silently changed its historical drill-down
   * (e.g. a run that matched 1/1 at the time could later show 1/2 if a
   * second must_find expectation was added afterward), which misrepresents
   * what actually happened during that run.
   */
  async getBatchDetail(workspaceId: string, batchId: string): Promise<EvalBatchDetail> {
    const batch = await this.repo.getBatch(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval batch not found');

    const [runs, excludedSkillOwnedCount] = await Promise.all([
      this.repo.runsForBatch(batch.id),
      this.repo.countSkillOwnedCases(workspaceId),
    ]);

    const cases = await Promise.all(
      runs.map(async (run) => {
        const caseRow = await this.repo.getCase(workspaceId, run.caseId);
        if (!caseRow) return null;
        const status: 'passed' | 'failed' | 'error' =
          run.pass === null ? 'error' : run.pass ? 'passed' : 'failed';
        // Legacy runs written before matched_count/expected_count existed
        // (nullable, pre-migration) fall back to a live re-score so old
        // history doesn't just disappear — but any run written since this
        // fix uses the frozen counts from write time.
        const scoreResult =
          run.pass === null
            ? null
            : run.matchedCount !== null && run.expectedCount !== null
              ? {
                  mustFindMatched: run.matchedCount,
                  mustFindTotal: run.expectedCount,
                  mustNotFlagViolations: 0,
                  // findings_count is NOT among the frozen counts (only
                  // matched/expected are persisted), so count the run's OWN
                  // persisted findings here — `actualOutput` is the model's
                  // kept-findings array at write time, never re-scored, so this
                  // is both correct and stable (previously hardcoded 0, which
                  // made the drill-down FINDINGS column always read 0 even when
                  // MATCHED was 1).
                  findingsCount: Array.isArray(run.actualOutput) ? run.actualOutput.length : 0,
                }
              : scoreCase(
                  expectationsFromJson(caseRow.expectedOutput),
                  Array.isArray(run.actualOutput)
                    ? (run.actualOutput as { file: string; start_line: number; end_line: number }[]).map((f) => ({
                        file: f.file,
                        startLine: f.start_line,
                        endLine: f.end_line,
                      }))
                    : [],
                );
        return batchCaseOutcome(run, caseRow, scoreResult, status);
      }),
    );

    return batchDetailDto(
      batch,
      cases.filter((c): c is NonNullable<typeof c> => c !== null),
      excludedSkillOwnedCount,
    );
  }

  async compareBatches(
    workspaceId: string,
    batchIdA: string,
    batchIdB: string,
  ): Promise<EvalBatchCompareResult> {
    const [a, b] = await Promise.all([
      this.getBatchDetail(workspaceId, batchIdA),
      this.getBatchDetail(workspaceId, batchIdB),
    ]);

    // Null-aware guard (#5): if EITHER batch has no real metric (unsealed —
    // shouldn't reach here since getBatchDetail 404s on a missing batch, or
    // all cases errored so recall/precision/citationAccuracy are null even
    // though the batch is sealed), refuse to fabricate a delta at all. The
    // wire contract's `deltas.*` fields are non-nullable numbers (frozen
    // contract, not owned by this fix) — there is no way to encode "no
    // data" in that shape, so surfacing a clear error here is preferable to
    // silently coercing null to 0 and rendering a phantom ±100% swing.
    if (
      a.recall == null ||
      b.recall == null ||
      a.precision == null ||
      b.precision == null ||
      a.citation_accuracy == null ||
      b.citation_accuracy == null
    ) {
      throw new ValidationError('One or both batches have no scored metrics to compare (all cases errored)');
    }

    return {
      a,
      b,
      deltas: {
        recall: b.recall - a.recall,
        precision: b.precision - a.precision,
        citation_accuracy: b.citation_accuracy - a.citation_accuracy,
        cost_usd: a.cost_usd != null && b.cost_usd != null ? b.cost_usd - a.cost_usd : null,
      },
      prompt_diff_available: a.system_prompt_snapshot != null && b.system_prompt_snapshot != null,
    };
  }

  /**
   * Trend points in CHRONOLOGICAL order (#3) — `repo.listTrendBatches`
   * orders newest-first (desc `ran_at`) for the batch-history table's own
   * needs; the trend chart plots by array index, so it must be reversed
   * here, at the trend-specific read path only.
   */
  async getTrend(workspaceId: string, agentId: string): Promise<EvalTrendPointV2[]> {
    const rows = await this.repo.listTrendBatches(workspaceId, agentId);
    // `listTrendBatches` already excludes status=null (unsealed/in-flight)
    // batches at the query level (#5). A SEALED batch can still have null
    // recall/precision/citationAccuracy if every case in it errored (no
    // scored case at all) — the `EvalTrendPointV2` wire contract's recall/
    // precision/citation_accuracy are non-nullable numbers (frozen contract,
    // not owned by this fix), so `trendPoint()` cannot represent "no data"
    // for a single point without fabricating 0%. Filter those out HERE
    // instead: an all-errored batch contributes no real signal to the trend
    // line, so it must not render as a fake 0%/0%/0% dip.
    const withRealMetrics = rows.filter((r) => r.recall !== null && r.precision !== null && r.citationAccuracy !== null);
    return withRealMetrics.slice().reverse().map(trendPoint);
  }

  /**
   * Clear ALL run history (batches + runs) for one agent, workspace-scoped —
   * the case DEFINITIONS themselves are preserved (only their run history
   * resets: Batch History empties, Trend empties, every case's last-run
   * status reverts to never-run). Guarded identically to the other
   * agent-scoped eval methods: verify the agent exists in this workspace via
   * `container.agentsRepo.getById` (the cross-cutting facade already used by
   * `EvalRunOrchestrator.startBatch`), else 404.
   */
  async clearHistory(
    workspaceId: string,
    agentId: string,
  ): Promise<{ deleted_batches: number; deleted_runs: number }> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const { deletedBatches, deletedRuns } = await this.repo.clearHistory(workspaceId, agentId);
    return { deleted_batches: deletedBatches, deleted_runs: deletedRuns };
  }

  /**
   * KPI delta vs. the previous FULL batch (AC-31 — calibration batches are
   * skipped as a baseline via `repo.previousFullBatch`, which now also
   * excludes unsealed batches, #5). Null-aware: "no data" on either side is
   * NOT coerced to 0 — a null metric means the delta itself is undefined,
   * not zero change.
   */
  async getKpiDelta(workspaceId: string, agentId: string, latestBatchId: string) {
    const latest = await this.repo.getBatch(workspaceId, latestBatchId);
    if (!latest) throw new NotFoundError('Eval batch not found');

    const previous = await this.repo.previousFullBatch(workspaceId, agentId, latest.ranAt);
    if (!previous) return null;

    if (
      latest.recall == null ||
      previous.recall == null ||
      latest.precision == null ||
      previous.precision == null ||
      latest.citationAccuracy == null ||
      previous.citationAccuracy == null
    ) {
      return null;
    }

    return {
      recall: latest.recall - previous.recall,
      precision: latest.precision - previous.precision,
      citation_accuracy: latest.citationAccuracy - previous.citationAccuracy,
    };
  }

  // ----------------------------------------------- cross-agent eval dashboard

  /**
   * One row per eval-configured agent in the workspace (AC-3): agent id/name/
   * model, its latest sealed full batch (or null if it has cases but has
   * never completed a full run), a small recall sparkline (last
   * `SPARKLINE_POINTS_CAP` sealed full batches, chronological order — same
   * reversal convention as `getTrend`), and its case_count. Returns `[]` when
   * no agent qualifies (AC-5) — the empty-state rendering is entirely the
   * client's concern.
   */
  async getOverview(workspaceId: string): Promise<EvalAgentSummary[]> {
    const summaries = await this.repo.listEvalConfiguredAgentSummaries(workspaceId);

    return Promise.all(
      summaries.map(async (summary) => {
        const recentBatches = await this.repo.recentTrendPointsForAgent(
          workspaceId,
          summary.agentId,
          SPARKLINE_POINTS_CAP,
        );
        // recentTrendPointsForAgent returns newest-first; the sparkline reads
        // left-to-right chronologically, same reversal convention as getTrend.
        const sparklinePoints = recentBatches
          .slice()
          .reverse()
          .filter((b) => b.recall !== null)
          .map((b) => ({ ran_at: b.ranAt.toISOString(), recall: b.recall as number }));

        return {
          agent_id: summary.agentId,
          agent_name: summary.agentName,
          model: summary.model,
          latest_batch: summary.latestBatch ? batchDto(summary.latestBatch) : null,
          latest_version: summary.latestVersion,
          sparkline_points: sparklinePoints,
          case_count: summary.caseCount,
        } satisfies EvalAgentSummary;
      }),
    );
  }

  /**
   * Recent batches (any kind) across ALL agents in the workspace, newest
   * first, capped at the server-fixed `RECENT_BATCHES_CAP` (25) — never a
   * client-supplied limit (AC-9's resolved NEEDS-CLARIFICATION).
   */
  async getRecentAcrossAgents(workspaceId: string): Promise<EvalRecentBatchRow[]> {
    const rows = await this.repo.listRecentBatchesAcrossAgents(workspaceId, RECENT_BATCHES_CAP);
    return rows.map((r) => ({
      batch: batchDto(r.batch),
      agent_id: r.agentId,
      agent_name: r.agentName,
      version: r.version,
      pass_count: r.passCount,
      total_count: r.totalCount,
    }));
  }

  /**
   * Fan-out trigger (AC-11/AC-12): starts a batch for EVERY eval-configured
   * agent in the workspace via the orchestrator's existing per-agent
   * `startBatch` (zero new LLM call types) and returns immediately —
   * insert-only, mirrors `startEvalRun`'s fast synchronous pattern. Does NOT
   * execute the batches; the caller must fan out `executeRunAll` separately,
   * detached from the request/response cycle (same convention as
   * `startEvalRun`/`executeEvalRun`).
   *
   * An agent whose case set became empty between page load and click (last
   * case deleted concurrently) has `startBatch` throw `ValidationError` —
   * that one agent is caught, logged, and skipped so it doesn't 500 the
   * whole fan-out; its `{agent_id, batch_id}` pair is simply omitted from
   * `started`. Any OTHER per-agent failure (e.g. the agent itself was
   * deleted between the summary query and this loop, which surfaces as
   * `NotFoundError` from `startBatch`'s own `agentsRepo.getById` lookup) is
   * caught and skipped the same way — a single bad agent must never abort
   * the whole run-all fan-out (the plan's stated intent). `log` is optional
   * (defaults to no-op) so existing callers/tests that omit it keep working;
   * the route should pass a `req.log.child({...})` taken before responding,
   * the same convention `executeRunAll`/`executeEvalRun` already use.
   */
  async startRunAll(
    workspaceId: string,
    log?: Logger,
  ): Promise<{ result: EvalRunAllResult; started: Awaited<ReturnType<EvalRunOrchestrator['startBatch']>>[] }> {
    const summaries = await this.repo.listEvalConfiguredAgentSummaries(workspaceId);

    const started: Awaited<ReturnType<EvalRunOrchestrator['startBatch']>>[] = [];
    for (const summary of summaries) {
      try {
        const startedBatch = await this.orchestrator.startBatch(workspaceId, summary.agentId);
        started.push(startedBatch);
      } catch (err) {
        // Skip ANY per-agent failure here — e.g. "Agent has no eval cases to
        // run" (ValidationError) or the agent having been deleted concurrently
        // (NotFoundError) — and continue the fan-out for the remaining agents.
        log?.warn(
          { err, workspaceId, agentId: summary.agentId },
          'eval: skipping agent in run-all (startBatch failed)',
        );
        continue;
      }
    }

    return {
      result: { started: started.map((s) => ({ agent_id: s.agent.id, batch_id: s.batch.id })) },
      started,
    };
  }

  /**
   * Fan out + seal every batch already started via `startRunAll`, bounded at
   * the orchestrator's CONCURRENCY cap (3, AC-13) — detached, see
   * `startRunAll`'s and `executeEvalRun`'s doc comments for the full
   * rationale (must not be awaited from within the route handler).
   *
   * Deliberately omits the explicit `concurrency` arg so it inherits
   * `runManyBatchesWithCap`'s own default (`CONCURRENCY = 3`,
   * `run-orchestrator.ts`) rather than duplicating the literal `3` here —
   * passing a hardcoded `3` would silently diverge from the single-agent
   * path if `CONCURRENCY` is ever tuned.
   */
  async executeRunAll(
    started: Awaited<ReturnType<EvalRunOrchestrator['startBatch']>>[],
    log?: Logger,
  ): Promise<void> {
    await this.orchestrator.runManyBatchesWithCap(started, undefined, log);
  }
}
