import {
  EvalBatchStatus,
  type EvalBatchCaseResult,
  type EvalBatchComparison,
  type EvalBatchDetail,
  type EvalBatchRecord,
  type EvalCaseRecord,
  type EvalCaseRunResult,
  type EvalCaseSource,
  type EvalCaseWrite,
  type EvalExpectedFinding,
  type EvalOwnerDashboard,
  type EvalOwnerKind,
  type EvalPromptDiffLine,
  type LLMProvider,
  type Provider,
  type UnifiedDiff,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import { AppError, ConflictError, NotFoundError } from '../../platform/errors.js';
import {
  EvalsRepository,
  type EvalBatchRow,
  type EvalCaseRow,
  type EvalRunRow,
} from './repository.js';
import { deriveExpectationKind } from './scoring.js';
import { DASHBOARD_BATCH_HISTORY_LIMIT, evalBaselineConfig } from './constants.js';
import {
  buildComparisonMetrics,
  buildOwnerDashboard,
  buildTrendSeries,
  toBatchRecord,
  toEvalCaseRecord,
  toEvalCaseRunResult,
} from './helpers.js';
import { diffPromptLines } from './prompt-diff.js';
import {
  runAgentCase,
  runSkillCase,
  type AgentRunConfig,
  type SkillRunConfig,
} from './pipeline/case-runner.js';
import {
  foldBatchAggregate,
  startAgentBatch,
  startSkillBatch,
  type BatchRunnerDeps,
} from './pipeline/batch-runner.js';
import type { CaseRunResult } from './pipeline/case-runner.js';
import { buildSkillCaseDiff } from '../_shared/diff-synth.js';

/**
 * T13 — evals service, routes and module registration (SPEC-03; see
 * docs/plans/09-eval-pipeline.md §4.2 for the HTTP surface this serves).
 *
 * Takes an explicit `EvalsServiceDeps` — NEVER the `Container`
 * (`modules/skills/service.ts` is the in-repo precedent this follows). The
 * two agent reads this module needs (a single agent by id, and every enabled
 * agent in a workspace) are NOT queried here with `drizzle-orm`/`db/schema`
 * — R2 forbids both. They arrive as two LAZY resolver closures the plugin
 * body (`routes.ts`, R5) builds over `app.container.agentsRepo` — the same
 * "lazy resolver stays lazy" seam `deps.llm` already uses, and the same
 * pattern `container.repoIntel`/`container.blast` use to let one module read
 * another's repository through the composition root rather than an import.
 *
 * `Deps.llm` mirrors `Container.llm` (id -> provider); `pipeline/case-runner.ts`
 * and `pipeline/batch-runner.ts` want a ZERO-ARG resolver already bound to one
 * agent's provider, so every call site below closes over it:
 * `() => this.deps.llm(agent.provider)`.
 */

export interface AgentRunnerInfo {
  id: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  version: number;
}

export interface EvalsServiceDeps {
  db: Db;
  /** Resolves an LLM provider by id — mirrors `Container.llm`, never a resolved client. */
  llm: (id: 'openai' | 'anthropic' | 'openrouter') => Promise<LLMProvider>;
  /** A single agent's runner config, or undefined if it does not exist in `workspaceId`. */
  resolveAgent: (workspaceId: string, agentId: string) => Promise<AgentRunnerInfo | undefined>;
  /** Every enabled agent in `workspaceId` (REQ-29's dashboard row set). */
  listEnabledAgents: (workspaceId: string) => Promise<AgentRunnerInfo[]>;
  /**
   * FIX-1: the ONE seam through which `pipeline/case-runner.ts` (R2) reaches
   * `adapters/git/diff-parser.ts::parseUnifiedDiff` (R4) — the composition
   * root (`routes.ts`) is the one construction site (onion-architecture §2).
   */
  parseUnifiedDiff: (raw: string) => UnifiedDiff;
  /**
   * AC-73 — the agent-free provider+model for a skill-owned case's baseline,
   * resolved via `resolveFeatureModel(container, workspaceId, 'eval_baseline')`
   * (`modules/_shared/feature-models.ts`). That function takes a `Container`,
   * which R2 (this file) may never import (onion-architecture §2), so it
   * arrives as a lazy closure the plugin body (`routes.ts`, R5) builds over
   * `app.container` — the same "lazy resolver" seam `deps.llm` already uses.
   */
  resolveEvalBaselineModel: (workspaceId: string) => Promise<{ provider: Provider; model: string }>;
}

/** REQ-10's semantic cap — the route schema only proves `expected_output` is an array. */
const MAX_EXPECTATIONS = 50;
/** REQ-15's counterpart — the semantic ceiling on cases per owner. */
const MAX_CASES_PER_OWNER = 200;
/** §4.3's 413 — `input_diff` size limit. */
const MAX_DIFF_BYTES = 256 * 1024;
/** REQ-14 — a `running` batch with no progress for this long is served as `failed` on read. */
const STALE_BATCH_MS = 60 * 60 * 1000;
/** AC-56: a skill case's authored filename, when absent/empty/whitespace-only.
 * Mirrors `_shared/diff-synth.ts`'s own private default — that file synthesizes
 * the DIFF from an already-normalized name; this is the one place that name is
 * derived, persisted (`eval_cases.input_filename`) and stamped onto every
 * expectation (AC-55/AC-56), so the default has to live here too. */
const SKILL_CASE_DEFAULT_FILENAME = 'snippet.ts';
/** §4.3's other 413 — each authored side (`before`/`after`) of a skill case, independently. */
const MAX_AUTHORED_SIDE_BYTES = 64 * 1024;

/** AC-56: trims, then falls back to the default — absent/empty/whitespace-only alike. */
function normalizeSkillCaseFilename(filename: string | null | undefined): string {
  const trimmed = filename?.trim();
  return trimmed ? trimmed : SKILL_CASE_DEFAULT_FILENAME;
}

export type DeleteCaseResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'conflict'; batchId: string };

/** Every field `EvalCaseListItem` (client `lib/hooks/evals.ts`) expects — an
 * `EvalCaseRecord` widened with that case's latest run, composed locally
 * (matching the client's own doc comment: "Not a contract type of its own"). */
export interface EvalCaseListItem extends EvalCaseRecord {
  latest_run: EvalCaseRunResult | null;
}

export class EvalsService {
  private repo: EvalsRepository;

  constructor(private deps: EvalsServiceDeps) {
    this.repo = new EvalsRepository(deps.db);
  }

  // =========================================================================
  // Cases — REQ-7, REQ-10, REQ-11, REQ-12, REQ-40, REQ-43, REQ-50, REQ-70
  // =========================================================================

  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseListItem[]> {
    const cases = await this.repo.listCases(workspaceId, ownerKind, ownerId);
    const latestRuns = await this.repo.getLatestRunsByCase(cases.map((c) => c.id));
    const byCase = new Map(latestRuns.map((run) => [run.caseId, run]));
    return cases.map((row) => ({
      ...toEvalCaseRecord(row),
      latest_run: byCase.has(row.id) ? toEvalCaseRunResult(byCase.get(row.id)!) : null,
    }));
  }

  /**
   * REQ-10/REQ-43: `expectation_kind` is always derived from `expected_output`
   * emptiness here — `EvalCaseWrite` carries no such field for a client to
   * smuggle one through in the first place. REQ-15/REQ-68's owner limits are
   * enforced HERE, never in the route — schema failures are 422, these are 400.
   */
  async createCase(workspaceId: string, input: EvalCaseWrite): Promise<EvalCaseRecord> {
    this.assertWithinCaps(input);
    const existing = await this.repo.listCases(workspaceId, input.owner_kind, input.owner_id);
    if (existing.length >= MAX_CASES_PER_OWNER) {
      throw new AppError(
        'too_many_cases',
        `This owner already has ${MAX_CASES_PER_OWNER} eval cases`,
        400,
      );
    }
    const prepared = this.prepareCaseWrite(input);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: prepared.inputDiff,
      inputFiles: prepared.inputFiles,
      inputMeta: null,
      expectedOutput: prepared.expectedOutput,
      notes: input.notes ?? null,
      expectationKind: deriveExpectationKind(prepared.expectedOutput),
      forbiddenRegions: input.forbidden_regions ?? null,
      inputFilename: prepared.inputFilename,
      seededFrom: input.seeded_from ?? null,
    });
    return toEvalCaseRecord(row);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    input: EvalCaseWrite,
  ): Promise<EvalCaseRecord | undefined> {
    this.assertWithinCaps(input);
    const prepared = this.prepareCaseWrite(input);
    const row = await this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff: prepared.inputDiff,
      inputFiles: prepared.inputFiles,
      expectedOutput: prepared.expectedOutput,
      notes: input.notes ?? null,
      expectationKind: deriveExpectationKind(prepared.expectedOutput),
      forbiddenRegions: input.forbidden_regions ?? null,
      inputFilename: prepared.inputFilename,
      seededFrom: input.seeded_from ?? null,
    });
    return row ? toEvalCaseRecord(row) : undefined;
  }

  /** REQ-12/REQ-70: a case referenced by a non-terminal batch is a 409, not a delete. */
  async deleteCase(workspaceId: string, id: string): Promise<DeleteCaseResult> {
    const existing = await this.repo.getCaseById(workspaceId, id);
    if (!existing) return { status: 'not_found' };
    const blocking = await this.repo.getNonTerminalBatchForCase(workspaceId, id);
    if (blocking) return { status: 'conflict', batchId: blocking.id };
    const deleted = await this.repo.deleteCase(workspaceId, id);
    return deleted ? { status: 'deleted' } : { status: 'not_found' };
  }

  /**
   * REQ-11/REQ-50: with-arm-only, and — owner decision, 2026-08-29 — it now
   * persists a **batch of 1**: one `eval_run_batches` row plus the `eval_runs`
   * row pointing at it, instead of the lone `batch_id: null` run it wrote
   * before. The dashboard's every read (`recent_batches`,
   * `getLatestTerminalBatch`, `getTrendBatches`) is built on
   * `eval_run_batches` alone, so a run with no batch row was structurally
   * invisible there; a batch of 1 now counts EVERYWHERE a set run does. The
   * owner accepted the consequence: run a single `must_not_flag` case and both
   * metric denominators are 0, so the headline Recall/Precision cards read
   * blank until the next set run (`server/INSIGHTS.md`, 2026-08-29).
   *
   * Two properties this ordering is chosen to guarantee:
   *
   * - **The batch is inserted ALREADY TERMINAL** (`insertCompletedBatch`),
   *   after the case has run — never `status: 'running'`, not for one
   *   round-trip. So it stays invisible to REQ-14's in-flight check (a single
   *   run neither takes nor is blocked by the owner's batch lock, which is the
   *   pre-existing behaviour this change had to preserve) and unreachable by
   *   `reapStaleRunningBatches`, which is what would otherwise turn a
   *   mid-run restart into a phantom `0/1` row on the dashboard.
   * - **Nothing is written before the case completes.** An engine throw still
   *   leaves no batch row and no run row at all, exactly as before — this
   *   method deliberately does not adopt the batch loop's per-case catch.
   *
   * The aggregate is folded by `foldBatchAggregate`, the same function
   * `runBatchLoop` uses, so a batch of 1 and a batch of N can never compute
   * their numbers differently.
   *
   * AC-68/AC-72/AC-73: a skill-owned case (`evalCase.ownerKind === 'skill'`)
   * no longer resolves a runner agent — `systemPrompt`/`provider`/`model`
   * come from `evalBaselineConfig` (the AC-72 constant + AC-73's agent-free
   * `resolveEvalBaselineModel`), plus the skill's own body, then runs
   * `runSkillCase(..., { runWithoutArm: false })` — AC-50's "the without arm
   * is never attempted at all" for a single-case run. This consults no
   * agent, no `agent_skills` link and no `agents` row — a skill with no
   * linked agent at all, or only disabled ones, runs exactly the same.
   */
  async runCase(workspaceId: string, id: string): Promise<EvalCaseRunResult | undefined> {
    const evalCase = await this.repo.getCaseById(workspaceId, id);
    if (!evalCase) return undefined;

    if (evalCase.ownerKind === 'skill') {
      const baseline = evalBaselineConfig(await this.deps.resolveEvalBaselineModel(workspaceId));
      // `getSkillSummary` rather than `getSkillBody`: the batch of 1 needs the
      // skill's own `version` for the row's non-null `owner_version`. Still
      // agent-free (AC-68) — same read `startBatch`'s skill branch uses.
      const summary = await this.repo.getSkillSummary(workspaceId, evalCase.ownerId);
      const config: SkillRunConfig = { ...baseline, skillBody: summary?.body ?? '' };
      const result = await runSkillCase(
        { llm: () => this.deps.llm(baseline.provider), parseUnifiedDiff: this.deps.parseUnifiedDiff },
        config,
        evalCase,
        // AC-50: the without arm is never attempted for a single-case run.
        // Being a batch of 1 does NOT change that — it is a property of the
        // RUN, not of batch membership.
        { runWithoutArm: false },
      );
      const row = await this.persistSingleCaseRun(workspaceId, evalCase, result, {
        ownerKind: 'skill',
        ownerVersion: summary?.version ?? 0,
        // AC-68/AC-69: a skill-owned run resolves no runner agent at all.
        runnerAgentId: null,
        runnerAgentVersion: null,
      });
      return toEvalCaseRunResult(row);
    }

    const agent = await this.deps.resolveAgent(workspaceId, evalCase.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');

    // The agent supplies the SYSTEM PROMPT (that is what an eval grades); the
    // provider+model come from the `eval_baseline` feature model, never from
    // `agents.model` — owner decision, 2026-08-29, see FEATURE_MODELS'
    // `eval_baseline` entry for why. Changing an agent's model therefore does
    // NOT move its eval numbers, which is the point: the grader is held fixed.
    const runner = await this.deps.resolveEvalBaselineModel(workspaceId);
    const config: AgentRunConfig = {
      systemPrompt: agent.systemPrompt,
      model: runner.model,
      provider: runner.provider,
    };
    const result = await runAgentCase(
      { llm: () => this.deps.llm(runner.provider), parseUnifiedDiff: this.deps.parseUnifiedDiff },
      config,
      evalCase,
    );
    const row = await this.persistSingleCaseRun(workspaceId, evalCase, result, {
      ownerKind: 'agent',
      ownerVersion: agent.version,
    });
    return toEvalCaseRunResult(row);
  }

  /**
   * The batch-of-1 write, shared by both `runCase` branches: fold the single
   * result exactly as `runBatchLoop` folds a set, insert the already-terminal
   * batch, then the run row pointing at it. Batch FIRST — `eval_runs.batch_id`
   * needs an id that exists.
   */
  private async persistSingleCaseRun(
    workspaceId: string,
    evalCase: EvalCaseRow,
    result: CaseRunResult,
    owner: {
      ownerKind: EvalOwnerKind;
      ownerVersion: number;
      runnerAgentId?: string | null;
      runnerAgentVersion?: number | null;
    },
  ): Promise<EvalRunRow> {
    const batch = await this.repo.insertCompletedBatch({
      workspaceId,
      ownerKind: owner.ownerKind,
      ownerId: evalCase.ownerId,
      ownerVersion: owner.ownerVersion,
      runnerAgentId: owner.runnerAgentId,
      runnerAgentVersion: owner.runnerAgentVersion,
      ...foldBatchAggregate({
        casesTotal: 1,
        casesProduced: result.errored ? 0 : 1,
        casesPassed: !result.errored && result.values.pass ? 1 : 0,
        // `tally`/`grounding` are the WITH arm's and are `null` on an errored
        // case — zeroes then fold to a `null` metric, never a `0`.
        tp: result.tally?.tp ?? 0,
        fn: result.tally?.fn ?? 0,
        fp: result.tally?.fp ?? 0,
        kept: result.grounding?.kept ?? 0,
        dropped: result.grounding?.dropped ?? 0,
        caseCosts: [{ caseId: evalCase.id, costUsd: result.values.costUsd }],
      }),
    });
    return this.repo.insertRun({ caseId: evalCase.id, batchId: batch.id, ...result.values });
  }

  // =========================================================================
  // Batches — REQ-13, REQ-14, REQ-15, REQ-17, REQ-18, REQ-19, REQ-31, REQ-40, REQ-68
  // =========================================================================

  /**
   * REQ-13: persists the `running` row and returns before any model call —
   * `startAgentBatch`/`startSkillBatch` (T9/T18) already resolve before their
   * own `setImmediate` loop starts; this method awaits nothing past that
   * point. REQ-14/REQ-15/REQ-68's checks are all BEFORE that call, never after.
   *
   * Two distinct branches, not one generalized over `ownerKind`: an
   * agent-owned batch resolves the OWNER itself and runs the with-arm-only
   * loop (`startAgentBatch`); a skill-owned batch resolves its RUNNER (a
   * different entity — REQ-68) plus the skill's own `version`, and runs the
   * two-arm ablation loop (`startSkillBatch`, T18). Forcing them through one
   * shared code path would need a config type wide enough for both `agent.
   * version` and the skill/runner split — `assertBatchStartable` is the one
   * piece both branches genuinely share (REQ-14's live-batch check, REQ-15's
   * zero-cases check), so that is what is factored out.
   */
  async startBatch(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<{ batchId: string }> {
    if (ownerKind === 'agent') {
      const agent = await this.deps.resolveAgent(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
      const cases = await this.assertBatchStartable(workspaceId, ownerKind, ownerId);

      // Same split as `runCase` above: agent prompt, `eval_baseline` model.
      const runner = await this.deps.resolveEvalBaselineModel(workspaceId);
      const config: AgentRunConfig = {
        systemPrompt: agent.systemPrompt,
        model: runner.model,
        provider: runner.provider,
      };
      const batchDeps: BatchRunnerDeps = {
        llm: () => this.deps.llm(runner.provider),
        parseUnifiedDiff: this.deps.parseUnifiedDiff,
        repo: this.repo,
      };
      const { batchId } = await startAgentBatch(batchDeps, {
        workspaceId,
        ownerId,
        ownerVersion: agent.version,
        agent: config,
        cases,
      });
      return { batchId };
    }

    // ownerKind === 'skill' — AC-68/AC-72/AC-73/AC-69 (T-C, 2026-08-29).
    //
    // Completes the gap the prior implementer reported as gate G2:
    // `EvalsRepository.getSkillSummary` (T-C's new R3 method) sources the
    // skill's own `version` agent-free, and `pipeline/batch-runner.ts`'s
    // `StartSkillBatchParams.runnerAgentId`/`runnerAgentVersion` are now
    // nullable — so a skill-owned SET-run consults no agent, no
    // `agent_skills` link and no `agents` row at all, exactly like
    // `runCase`'s already-agent-free path above, and persists `null` in
    // both `runner_agent_id` and `runner_agent_version` (AC-69: nullable
    // for historical rows too). `systemPrompt`/`model`/`provider` are the
    // AC-72/AC-73 baseline, never a resolved agent's own values.
    const summary = await this.repo.getSkillSummary(workspaceId, ownerId);
    if (!summary) throw new NotFoundError('Skill not found');
    const cases = await this.assertBatchStartable(workspaceId, ownerKind, ownerId);

    const baseline = evalBaselineConfig(await this.deps.resolveEvalBaselineModel(workspaceId));
    const config: SkillRunConfig = { ...baseline, skillBody: summary.body };
    const batchDeps: BatchRunnerDeps = {
      llm: () => this.deps.llm(baseline.provider),
      parseUnifiedDiff: this.deps.parseUnifiedDiff,
      repo: this.repo,
    };
    const { batchId } = await startSkillBatch(batchDeps, {
      workspaceId,
      ownerId,
      ownerVersion: summary.version,
      runnerAgentId: null,
      runnerAgentVersion: null,
      config,
      cases,
    });
    return { batchId };
  }

  /** REQ-14/REQ-15 — shared by both `startBatch` branches: no live (non-stale)
   * batch already running, and at least one case to run. Throws before either
   * branch inserts a batch row. */
  private async assertBatchStartable(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    const live = await this.findLiveRunningBatch(workspaceId, ownerKind, ownerId);
    if (live) {
      throw new ConflictError('An eval batch is already running for this owner', {
        batch_id: live.id,
      });
    }
    const cases = await this.repo.listCases(workspaceId, ownerKind, ownerId);
    if (cases.length === 0) {
      throw new AppError('no_cases', 'This owner has no eval cases to run', 400);
    }
    return cases;
  }

  /**
   * REQ-17/REQ-18/REQ-19/REQ-25: served WHILE `running` — cases completed so
   * far, never a wait for terminal. REQ-14's staleness is evaluated here too
   * (a stale `running` row reads as `failed`) without writing anything back —
   * "no reaper, no job registration" (this task's `Do:`).
   */
  async getBatch(workspaceId: string, id: string): Promise<EvalBatchDetail | undefined> {
    const batch = await this.repo.getBatchById(workspaceId, id);
    if (!batch) return undefined;
    const runs = await this.repo.listRunsForBatch(id);

    let effectiveStatus: string = batch.status;
    if (batch.status === 'running' && this.isStale(batch, this.latestRunAt(runs))) {
      effectiveStatus = 'failed';
    }

    const cases: EvalBatchCaseResult[] = [];
    for (const run of runs) {
      const caseRow = await this.repo.getCaseById(workspaceId, run.caseId);
      cases.push({
        case_id: run.caseId,
        case_name: caseRow?.name ?? 'Unknown case',
        // REQ-19: `pass` is only ever `null` on the errored path
        // (`case-runner.ts::erroredResult`) — a successfully scored run
        // always carries a boolean, even when its recall/precision are `null`
        // from a zero denominator (REQ-25).
        errored: run.pass === null,
        pass: run.pass,
        recall: run.recall,
        precision: run.precision,
        citation_accuracy: run.citationAccuracy,
        // Skill ablation (REQ-67) is T18's; every case here is agent-owned.
        skill_lift: null,
      });
    }

    return {
      ...toBatchRecord(batch),
      status: EvalBatchStatus.parse(effectiveStatus),
      cases,
    };
  }

  async listBatches(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalBatchRecord[]> {
    const rows = await this.repo.listBatchHistory(workspaceId, ownerKind, ownerId);
    return rows.map(toBatchRecord);
  }

  /** REQ-34/REQ-35/REQ-36/REQ-40/REQ-71 — the compare-modal payload. */
  async compareBatches(
    workspaceId: string,
    aId: string,
    bId: string,
  ): Promise<EvalBatchComparison> {
    if (aId === bId) {
      throw new AppError('same_batch', 'Cannot compare a batch with itself', 400);
    }
    const [batchA, batchB] = await Promise.all([
      this.repo.getBatchById(workspaceId, aId),
      this.repo.getBatchById(workspaceId, bId),
    ]);
    if (!batchA || !batchB) throw new NotFoundError('Batch not found');

    const [older, newer] = this.orderBatches(batchA, batchB);
    const metrics = buildComparisonMetrics(older, newer);
    const sameVersion = older.ownerVersion === newer.ownerVersion;

    let promptDiff: EvalPromptDiffLine[] | null = null;
    if (!sameVersion) {
      const [oldText, newText] = await Promise.all([
        this.ownerVersionText(workspaceId, older),
        this.ownerVersionText(workspaceId, newer),
      ]);
      promptDiff = diffPromptLines(oldText, newText);
    }

    return { ...metrics, same_version: sameVersion, prompt_diff: promptDiff };
  }

  // =========================================================================
  // Dashboard — REQ-29, REQ-30, REQ-32, REQ-33, REQ-37, REQ-71
  // =========================================================================

  /**
   * REQ-29/REQ-30: one row per ENABLED agent. `EvalOwnerDashboard` (the
   * contract T1 shipped) carries no `model` field — see this task's report,
   * "Notes for the integrator" — so `model` is NOT served here even though
   * `AgentRunnerInfo.model` is available; a field the schema does not declare
   * would be stripped on serialization even if this method attached it.
   */
  async getDashboard(workspaceId: string): Promise<EvalOwnerDashboard[]> {
    const agents = await this.deps.listEnabledAgents(workspaceId);
    const rows: EvalOwnerDashboard[] = [];
    for (const agent of agents) {
      rows.push(await this.buildDashboardRow(workspaceId, 'agent', agent.id));
    }
    return rows;
  }

  /** REQ-32/REQ-33/REQ-37/REQ-71 — the drill-in for one agent. */
  async getOwnerDashboard(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalOwnerDashboard | undefined> {
    const agent = await this.deps.resolveAgent(workspaceId, agentId);
    if (!agent) return undefined;
    return this.buildDashboardRow(workspaceId, 'agent', agentId);
  }

  private async buildDashboardRow(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalOwnerDashboard> {
    const [cases, history, trend] = await Promise.all([
      this.repo.listCases(workspaceId, ownerKind, ownerId),
      // Bounded: `recent_batches` ships this list for EVERY agent on one
      // `GET /evals/dashboard`, and a single-case run now adds a batch row per
      // click. The client's own feed slices to `RECENT_RUNS_LIMIT` (10), so
      // this cap is the payload's, not the feature's. The trend below is
      // windowed separately and is unaffected.
      this.repo.listBatchHistory(workspaceId, ownerKind, ownerId, DASHBOARD_BATCH_HISTORY_LIMIT),
      // REQ-37's trailing-30-day window is narrower than the full history used
      // for REQ-30's latest/REQ-32's delta — `buildOwnerDashboard`'s own
      // `batches` field drives both from one set, so the trend it computes is
      // overridden below with the properly windowed one.
      this.repo.getTrendBatches(workspaceId, ownerKind, ownerId, 30),
    ]);
    const dashboard = buildOwnerDashboard({
      ownerKind,
      ownerId,
      casesTotal: cases.length,
      batches: history,
      recentBatches: history,
    });
    return { ...dashboard, trend: buildTrendSeries(trend) };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private assertWithinCaps(input: EvalCaseWrite): void {
    if (input.expected_output.length > MAX_EXPECTATIONS) {
      throw new AppError(
        'too_many_expectations',
        `A case may declare at most ${MAX_EXPECTATIONS} expectations`,
        400,
      );
    }
    if (input.input_diff && Buffer.byteLength(input.input_diff, 'utf8') > MAX_DIFF_BYTES) {
      throw new AppError('diff_too_large', 'input_diff exceeds 256 KiB', 413);
    }
  }

  /**
   * AC-55/AC-56/AC-57/AC-59: the write-time shaping shared by `createCase` and
   * `updateCase`. An agent-owned write passes its fields through unchanged
   * (the route's `superRefine` already required `file` on every expectation).
   * A skill-owned write:
   *  - normalizes the filename (AC-56), building the diff with T5's
   *    `buildSkillCaseDiff` off the NORMALIZED name — never the raw one;
   *  - persists the authored source (with that same normalized filename, so a
   *    later read/preview and the diff agree) AND the synthesized diff
   *    (AC-59) — the client-supplied `input_diff`, if any, is never used;
   *  - overwrites `file` on EVERY expectation with the synthesized filename
   *    (AC-55/AC-56), regardless of what the client sent.
   */
  private prepareCaseWrite(input: EvalCaseWrite): {
    inputDiff: string | null;
    inputFiles: EvalCaseSource | null;
    inputFilename: string | null;
    expectedOutput: EvalExpectedFinding[];
  } {
    if (input.owner_kind !== 'skill') {
      return {
        inputDiff: input.input_diff ?? null,
        inputFiles: input.input_files ?? null,
        inputFilename: input.filename ?? null,
        expectedOutput: input.expected_output,
      };
    }

    if (!input.input_files) {
      throw new AppError(
        'missing_source',
        'A skill-owned case requires authored before/after source',
        400,
      );
    }
    const source = input.input_files;
    const before = source.kind === 'modified_file' ? source.before : null;
    this.assertAuthoredSideWithinCap(source.after);
    if (before !== null) this.assertAuthoredSideWithinCap(before);

    const filename = normalizeSkillCaseFilename(source.filename);
    const inputDiff = buildSkillCaseDiff({ before, after: source.after, filename });
    const inputFiles: EvalCaseSource =
      source.kind === 'modified_file'
        ? { kind: 'modified_file', filename, before: source.before, after: source.after }
        : { kind: 'new_file', filename, after: source.after };
    const expectedOutput = input.expected_output.map((expectation) => ({ ...expectation, file: filename }));

    return { inputDiff, inputFiles, inputFilename: filename, expectedOutput };
  }

  /** §4.3's 413 — each authored side of a skill case's source, independently. */
  private assertAuthoredSideWithinCap(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > MAX_AUTHORED_SIDE_BYTES) {
      throw new AppError('authored_side_too_large', 'Authored source exceeds 64 KiB', 413);
    }
  }

  /** REQ-14: the live (non-stale) `running` batch for an owner, or none. */
  private async findLiveRunningBatch(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalBatchRow | null> {
    const history = await this.repo.listBatchHistory(workspaceId, ownerKind, ownerId);
    for (const batch of history) {
      if (batch.status !== 'running') continue;
      const runs = await this.repo.listRunsForBatch(batch.id);
      if (!this.isStale(batch, this.latestRunAt(runs))) return batch;
    }
    return null;
  }

  private latestRunAt(runs: EvalRunRow[]): Date | null {
    return runs.reduce<Date | null>((acc, run) => (!acc || run.ranAt > acc ? run.ranAt : acc), null);
  }

  /** REQ-14: stale iff no progress (started_at, or the newest run) for 60+ minutes. */
  private isStale(batch: EvalBatchRow, latestRunAt: Date | null): boolean {
    const reference = latestRunAt && latestRunAt > batch.startedAt ? latestRunAt : batch.startedAt;
    return Date.now() - reference.getTime() > STALE_BATCH_MS;
  }

  private orderBatches(a: EvalBatchRow, b: EvalBatchRow): [EvalBatchRow, EvalBatchRow] {
    if (a.startedAt.getTime() !== b.startedAt.getTime()) {
      return a.startedAt < b.startedAt ? [a, b] : [b, a];
    }
    return a.id < b.id ? [a, b] : [b, a];
  }

  /** REQ-35: the authoring text of one batch's owner at that batch's `owner_version`. */
  private async ownerVersionText(workspaceId: string, batch: EvalBatchRow): Promise<string> {
    if (batch.ownerKind === 'agent') {
      const config = await this.repo.getAgentVersionConfig(
        workspaceId,
        batch.ownerId,
        batch.ownerVersion,
      );
      if (config && typeof config === 'object' && 'system_prompt' in config) {
        return String((config as { system_prompt?: unknown }).system_prompt ?? '');
      }
      return '';
    }
    return (await this.repo.getSkillVersionBody(batch.ownerId, batch.ownerVersion)) ?? '';
  }
}
