import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type {
  SkillEvalCaseCreateInput,
  SkillEvalCaseListItem,
  SkillEvalBatch,
  SkillEvalBatchDetail,
  SkillEvalTrendPoint,
  SkillEvalBatchCompareResult,
  SkillEvalKpiDeltaResponse,
  SkillEvalClearHistoryResponse,
} from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import { SkillEvalRepository } from './eval-repository.js';
import { SkillEvalOrchestrator, type Logger } from './eval-orchestrator.js';

/**
 * SkillEvalService — case CRUD (reusing `SkillsRepository`'s existing
 * `insertEvalCase`/`updateEvalCase`/`deleteEvalCase`, never duplicating them
 * here) + run orchestration (delegated to `SkillEvalOrchestrator`) + read-side
 * batch history/detail composition, for the skill-eval pipeline (sibling to
 * `eval/service.ts`'s agent-eval methodology — entirely independent, see
 * docs/plans/2026-07-06-skill-eval-pipeline.md).
 *
 * Cross-module reads (a finding's file/line/rationale/PR diff) go through
 * `container.reviewRepo` — the container's already-exposed cross-cutting
 * repository facade (`platform/container.ts`'s `reviewRepo` getter) — never a
 * direct `reviews/repository.js` import (module isolation, R6).
 */
export class SkillEvalService {
  private repo: SkillEvalRepository;
  private orchestrator: SkillEvalOrchestrator;

  constructor(private container: Container) {
    this.repo = new SkillEvalRepository(container.db);
    this.orchestrator = new SkillEvalOrchestrator(container);
  }

  // -------------------------------------------------------------- case CRUD

  /** Every case for this skill, joined with its most recent run outcome
   *  (AC-1, AC-28). 404s if the skill doesn't exist in this workspace. */
  async listCases(workspaceId: string, skillId: string): Promise<SkillEvalCaseListItem[]> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const rows = await this.repo.listCases(workspaceId, skillId);
    return Promise.all(
      rows.map(async (row) => {
        const latestRun = await this.repo.latestRunForCase(row.id);
        return caseListItem(row, latestRun);
      }),
    );
  }

  /**
   * Hand-authored case (AC-2, AC-3): validated inline BEFORE persistence —
   * neither rule is a clean Zod refinement across two independent
   * optional-with-default arrays, so the service throws explicitly instead.
   */
  async createCaseManual(
    workspaceId: string,
    skillId: string,
    input: SkillEvalCaseCreateInput,
  ): Promise<SkillEvalCaseListItem> {
    await this.assertSkillExists(workspaceId, skillId);
    validateCaseInput(input);

    const row = await this.container.skillsRepo.insertEvalCase({
      workspaceId,
      skillId,
      name: input.name,
      input_diff: input.fixture,
      expected_output: {
        practices: input.practices,
        grounding: input.grounding,
        threshold: input.threshold ?? 0.6,
      },
      input_meta: { source: 'manual' },
      notes: input.notes ?? undefined,
    });

    return caseListItem(row, null);
  }

  /**
   * Promote an already-accepted/dismissed finding into a skill eval case
   * (AC-4–AC-8). The skill is an EXPLICIT param, never inferred from the
   * finding (AC-4).
   */
  async createCaseFromFinding(
    workspaceId: string,
    skillId: string,
    findingId: string,
  ): Promise<SkillEvalCaseListItem> {
    await this.assertSkillExists(workspaceId, skillId);

    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, pull } = ctx;

    let practices: string[];
    let grounding: string[];

    if (finding.acceptedAt) {
      // AC-6: a positive expectation templated deterministically from the
      // finding's own fields — zero LLM calls.
      practices = [`review output identifies the ${finding.category ?? 'issue'} in ${finding.file}`];
      grounding = extractKeyTerms(finding.title, finding.rationale);
    } else if (finding.dismissedAt) {
      // AC-7: a negative expectation, judged (not grounding-gated) — no
      // substring-presence gate can assert an absence.
      practices = [`review output does NOT flag ${finding.file} for ${finding.category ?? 'this issue'}`];
      grounding = [];
    } else {
      throw new ValidationError('Finding must be accepted or dismissed first');
    }

    // Reuse the EXACT file-scoped diff extraction from
    // `eval/service.ts:createCaseFromFinding` (~lines 122-142), duplicated
    // locally per R6 — must behave identically (same "no diff available for
    // this file" guard).
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

    if (!fileDiff) {
      throw new ValidationError('No diff available for this file — cannot create an eval case from this finding');
    }

    const inputDiff = [
      `diff --git a/${fileDiff.path} b/${fileDiff.path}`,
      `--- a/${fileDiff.path}`,
      `+++ b/${fileDiff.path}`,
      prFiles.find((f) => f.path === finding.file)?.patch ?? '',
    ].join('\n');

    const row = await this.container.skillsRepo.insertEvalCase({
      workspaceId,
      skillId,
      name: finding.title,
      input_diff: inputDiff,
      expected_output: { practices, grounding, threshold: 0.6 },
      input_meta: { source: 'finding', source_finding_id: findingId, source_pr_number: pull.number },
      notes: finding.rationale,
    });

    return caseListItem(row, null);
  }

  /** Full-replacement edit (AC-39): same AC-2/AC-3 validation as
   *  `createCaseManual`, plus defense-in-depth threshold re-validation. */
  async updateCase(
    workspaceId: string,
    skillId: string,
    caseId: string,
    input: SkillEvalCaseCreateInput,
  ): Promise<SkillEvalCaseListItem> {
    await this.assertSkillExists(workspaceId, skillId);
    validateCaseInput(input);

    const threshold = input.threshold ?? 0.6;
    if (threshold < 0 || threshold > 1) {
      throw new ValidationError('threshold must be between 0 and 1');
    }

    const row = await this.container.skillsRepo.updateEvalCase(workspaceId, skillId, caseId, {
      name: input.name,
      input_diff: input.fixture,
      expected_output: { practices: input.practices, grounding: input.grounding, threshold },
      notes: input.notes ?? undefined,
    });
    if (!row) throw new NotFoundError('Eval case not found');

    return caseListItem(row, null);
  }

  /** Existence/ownership check, then delete (AC-9's confirmation is client-side). */
  async deleteCase(workspaceId: string, skillId: string, caseId: string): Promise<void> {
    const existing = await this.repo.getCase(workspaceId, caseId);
    if (!existing || existing.ownerKind !== 'skill' || existing.ownerId !== skillId) {
      throw new NotFoundError('Eval case not found');
    }
    await this.container.skillsRepo.deleteEvalCase(workspaceId, caseId);
  }

  // ------------------------------------------------------------------- runs

  /**
   * Start a batch run (AC-19's 202 flow): resolves the run target and
   * inserts the batch row synchronously, then returns immediately WITHOUT
   * awaiting the case fan-out. The caller (route handler) kicks off
   * `executeEvalRun` detached (with a `req.log.child({...})` taken BEFORE
   * responding) and must not await it.
   */
  async startEvalRun(workspaceId: string, skillId: string, hostAgentId: string, caseIds?: string[]) {
    return this.orchestrator.startBatch(workspaceId, skillId, hostAgentId, caseIds);
  }

  /** Fan out + seal a batch already started via `startEvalRun` — detached, see above. */
  async executeEvalRun(
    started: Awaited<ReturnType<SkillEvalOrchestrator['startBatch']>>,
    log?: Logger,
  ): Promise<{ status: 'clean' | 'degraded' }> {
    return this.orchestrator.executeBatch(
      started.batch,
      started.skill,
      started.hostAgent,
      started.skillBodies,
      started.targetCases,
      log,
    );
  }

  /**
   * Synchronous start+run+seal in one call — test convenience only. Routes
   * must use `startEvalRun` + detached `executeEvalRun` instead (AC-19).
   */
  async runBatch(workspaceId: string, skillId: string, hostAgentId: string, caseIds?: string[]) {
    return this.orchestrator.runBatch(workspaceId, skillId, hostAgentId, caseIds);
  }

  // -------------------------------------------------------------- read-side

  async listBatchHistory(workspaceId: string, skillId: string): Promise<SkillEvalBatch[]> {
    const rows = await this.repo.listBatchHistory(workspaceId, skillId);
    return rows.map(batchDto);
  }

  async getBatchDetail(workspaceId: string, batchId: string): Promise<SkillEvalBatchDetail> {
    const batch = await this.repo.getBatch(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval batch not found');

    const runs = await this.repo.runsForBatch(batch.id);
    const cases = await Promise.all(
      runs.map(async (run) => {
        const caseRow = await this.repo.getCase(workspaceId, run.caseId);
        if (!caseRow) return null;
        return runToOutcomeDto(run, caseRow);
      }),
    );

    return {
      ...batchDto(batch),
      cases: cases.filter((c): c is NonNullable<typeof c> => c !== null),
    };
  }

  /**
   * Compare two batches side by side (mirrors `eval/service.ts`'s
   * `compareBatches`). Null-aware guard: if EITHER batch has no real scored
   * metric (`judge_score`/`grounding_pass_rate` null, or `cases_total` is
   * null/zero so `cases_passing_rate` can't be computed), refuse to fabricate
   * a delta at all — the `deltas.*` fields are non-nullable numbers (frozen
   * contract), so surfacing a clear error is preferable to silently coercing
   * null to 0 and rendering a phantom swing.
   */
  async compareBatches(
    workspaceId: string,
    batchIdA: string,
    batchIdB: string,
  ): Promise<SkillEvalBatchCompareResult> {
    const [a, b] = await Promise.all([
      this.getBatchDetail(workspaceId, batchIdA),
      this.getBatchDetail(workspaceId, batchIdB),
    ]);

    if (!hasScoredMetrics(a) || !hasScoredMetrics(b)) {
      throw new ValidationError('One or both batches have no scored metrics to compare');
    }

    return {
      a,
      b,
      deltas: {
        judge_score: (b.judge_score as number) - (a.judge_score as number),
        grounding_pass_rate: (b.grounding_pass_rate as number) - (a.grounding_pass_rate as number),
        cases_passing_rate:
          (b.cases_passing as number) / b.cases_total - (a.cases_passing as number) / a.cases_total,
      },
    };
  }

  /**
   * Trend points in CHRONOLOGICAL order — `repo.listTrendBatches` orders
   * newest-first (desc `ran_at`) for the batch-history table's own needs; the
   * trend chart plots by array index, so it must be reversed here, at the
   * trend-specific read path only. A SEALED batch can still have no real
   * signal (every case in it errored, or `cases_total` is 0/null) — such a
   * batch contributes no real signal to the trend line and must not render as
   * a fake 0%/0%/0% dip, so it is filtered out entirely rather than coerced.
   */
  async getTrend(workspaceId: string, skillId: string): Promise<SkillEvalTrendPoint[]> {
    const rows = await this.repo.listTrendBatches(workspaceId, skillId);
    const withRealMetrics = rows.filter(
      (r) =>
        r.judgeScore !== null &&
        r.groundingPassRate !== null &&
        r.casesPassing !== null &&
        r.casesTotal !== null &&
        r.casesTotal !== 0,
    );
    return withRealMetrics
      .slice()
      .reverse()
      .map((row) => ({
        batch_id: row.id,
        ran_at: row.ranAt.toISOString(),
        judge_score: row.judgeScore as number,
        grounding_pass_rate: row.groundingPassRate as number,
        cases_passing_rate: (row.casesPassing as number) / (row.casesTotal as number),
        is_degraded: row.status === 'degraded',
        snapshot_identity: row.snapshotIdentity,
        cost_usd: row.costUsd,
      }));
  }

  /**
   * KPI delta vs. the previous FULL batch (calibration batches are skipped as
   * a baseline via `repo.previousFullBatch`, which also excludes unsealed
   * batches). Null-aware: "no data" on either side, or no baseline at all, is
   * NOT coerced to 0 — returns `null` (never throws) since the client treats
   * a missing KPI delta as "nothing to show yet", not an error state.
   */
  async getKpiDelta(
    workspaceId: string,
    skillId: string,
    latestBatchId: string,
  ): Promise<SkillEvalKpiDeltaResponse> {
    const latest = await this.repo.getBatch(workspaceId, latestBatchId);
    if (!latest) throw new NotFoundError('Eval batch not found');

    const previous = await this.repo.previousFullBatch(workspaceId, skillId, latest.ranAt);
    if (!previous) return null;

    if (
      latest.judgeScore == null ||
      previous.judgeScore == null ||
      latest.groundingPassRate == null ||
      previous.groundingPassRate == null ||
      latest.casesPassing == null ||
      previous.casesPassing == null ||
      !latest.casesTotal ||
      !previous.casesTotal
    ) {
      return null;
    }

    return {
      judge_score: latest.judgeScore - previous.judgeScore,
      grounding_pass_rate: latest.groundingPassRate - previous.groundingPassRate,
      cases_passing_rate: latest.casesPassing / latest.casesTotal - previous.casesPassing / previous.casesTotal,
    };
  }

  /**
   * Clear ALL run history (skill_eval_batches + eval_runs) for one skill,
   * workspace-scoped — the case DEFINITIONS themselves are preserved (only
   * their run history resets: Batch History empties, Trend empties, every
   * case's last-run status reverts to never-run). Guarded identically to the
   * other skill-scoped eval methods: verify the skill exists via
   * `container.skillsRepo.getById`, else 404 (mirrors the agent-eval
   * precedent's `container.agentsRepo.getById` guard).
   */
  async clearHistory(workspaceId: string, skillId: string): Promise<SkillEvalClearHistoryResponse> {
    await this.assertSkillExists(workspaceId, skillId);

    const { deletedBatches, deletedRuns } = await this.repo.clearHistory(workspaceId, skillId);
    return { deleted_batches: deletedBatches, deleted_runs: deletedRuns };
  }

  // ------------------------------------------------------------------ utils

  private async assertSkillExists(workspaceId: string, skillId: string): Promise<void> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
  }
}

// =============================================================== helpers ===

/**
 * True when a `SkillEvalBatchDetail` has real, comparable metrics: non-null
 * `judge_score`/`grounding_pass_rate`/`cases_passing`, and a non-null,
 * non-zero `cases_total` (needed to compute `cases_passing_rate` without
 * dividing by zero). Used by `compareBatches` to refuse fabricating a delta
 * against a batch with no real signal (e.g. every case errored).
 */
function hasScoredMetrics(batch: SkillEvalBatchDetail): boolean {
  return (
    batch.judge_score !== null &&
    batch.grounding_pass_rate !== null &&
    batch.cases_passing !== null &&
    !!batch.cases_total
  );
}

/** AC-2/AC-3 cross-field validation, shared by `createCaseManual`/`updateCase`. */
function validateCaseInput(input: SkillEvalCaseCreateInput): void {
  if (input.fixture.trim().length === 0) {
    throw new ValidationError('Fixture must not be empty');
  }
  if (input.practices.length === 0 && input.grounding.length === 0) {
    throw new ValidationError('Case must have at least one practice or grounding term');
  }
}

/** Deterministic key-term extraction from a finding's title/rationale — NOT
 *  an LLM summary (AC-6). Splits on non-word characters, drops short/common
 *  stopwords, dedupes, and caps at a small handful of terms so the grounding
 *  gate stays a meaningful (not trivially-satisfied) check. */
function extractKeyTerms(title: string, rationale: string): string[] {
  const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'is', 'are', 'this', 'that', 'it', 'be', 'for', 'with', 'as', 'at', 'by', 'from',
  ]);
  const words = `${title} ${rationale}`
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3 && !STOPWORDS.has(w.toLowerCase()));

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(w);
    if (terms.length >= 3) break;
  }
  return terms;
}

/** `eval_cases.expected_output` is untyped JSONB — parse defensively to the
 *  skill-eval `{practices, grounding, threshold}` shape (AC-10 — threshold
 *  defaults to 0.6 when absent). */
function expectedOutputFromJson(raw: unknown): { practices: string[]; grounding: string[]; threshold: number } {
  const obj = (raw ?? {}) as { practices?: unknown; grounding?: unknown; threshold?: unknown };
  return {
    practices: Array.isArray(obj.practices) ? (obj.practices as string[]) : [],
    grounding: Array.isArray(obj.grounding) ? (obj.grounding as string[]) : [],
    threshold: typeof obj.threshold === 'number' ? obj.threshold : 0.6,
  };
}

/** Fine-grained skill-eval outcome envelope persisted into
 *  `eval_runs.actual_output` by the orchestrator (AC-30) — carries the exact
 *  status + judge signal that the plain boolean `eval_runs.pass` cannot, so a
 *  read from persisted history reconstructs all FIVE case states (not just
 *  four). Parsed defensively: legacy rows written before this envelope existed
 *  (or agent-eval rows) return null and fall back to the boolean-derived
 *  status. */
interface SkillRunOutput {
  status: 'passed' | 'failed_grounding' | 'failed_judge' | 'error';
  grounding_missing: string[];
  judge_score: number | null;
  judge_evidence: { practice: string; passed: boolean; evidence: string }[] | null;
}

function parseSkillRunOutput(raw: unknown): SkillRunOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (
    status !== 'passed' &&
    status !== 'failed_grounding' &&
    status !== 'failed_judge' &&
    status !== 'error'
  ) {
    return null;
  }
  return {
    status,
    grounding_missing: Array.isArray(o.grounding_missing) ? (o.grounding_missing as string[]) : [],
    judge_score: typeof o.judge_score === 'number' ? o.judge_score : null,
    judge_evidence: Array.isArray(o.judge_evidence)
      ? (o.judge_evidence as { practice: string; passed: boolean; evidence: string }[])
      : null,
  };
}

/** Map an `eval_cases` row (+ its most recent skill-eval run, if any) to the
 *  shared `SkillEvalCaseListItem` DTO. */
function caseListItem(row: EvalCaseRow, latestRun: EvalRunRow | null): SkillEvalCaseListItem {
  const expected = expectedOutputFromJson(row.expectedOutput);
  const meta = (row.inputMeta ?? null) as { source?: 'finding' | 'manual'; source_finding_id?: string; source_pr_number?: number } | null;

  let last_run_status: SkillEvalCaseListItem['last_run_status'];
  let last_run_summary: string | null = null;

  if (!latestRun) {
    last_run_status = 'never_run';
  } else if (latestRun.pass === null) {
    last_run_status = 'error';
    last_run_summary = latestRun.errorMessage ?? null;
  } else if (latestRun.pass) {
    last_run_status = 'passed';
    last_run_summary = 'passed';
  } else {
    // pass === false — distinguish failed_grounding vs failed_judge from the
    // fine-grained outcome envelope the orchestrator persists in actualOutput
    // (AC-30), so the distinction survives a read from history, not just the
    // live run. Legacy rows without the envelope fall back to failed_judge.
    const parsed = parseSkillRunOutput(latestRun.actualOutput);
    last_run_status = parsed?.status === 'failed_grounding' ? 'failed_grounding' : 'failed_judge';
    last_run_summary =
      last_run_status === 'failed_grounding'
        ? parsed && parsed.grounding_missing.length > 0
          ? `missing grounding: ${parsed.grounding_missing.join(', ')}`
          : 'failed grounding'
        : 'failed';
  }

  return {
    id: row.id,
    skill_id: row.ownerId,
    name: row.name,
    source: meta?.source ?? 'manual',
    source_finding_id: meta?.source_finding_id ?? null,
    source_pr_number: meta?.source_pr_number ?? null,
    fixture: row.inputDiff ?? '',
    practices: expected.practices,
    grounding: expected.grounding,
    threshold: expected.threshold,
    last_run_status,
    last_run_summary,
    last_host_agent_id: null,
  };
}

/** Map a `skill_eval_batches` row to the shared `SkillEvalBatch` DTO. */
function batchDto(row: {
  id: string;
  skillId: string;
  hostAgentId: string;
  kind: 'full' | 'calibration';
  status: 'clean' | 'degraded' | null;
  snapshotIdentity: unknown;
  model: string;
  judgeScore: number | null;
  groundingPassRate: number | null;
  casesPassing: number | null;
  casesTotal: number | null;
  costUsd: number | null;
  ranAt: Date;
}): SkillEvalBatch {
  return {
    id: row.id,
    skill_id: row.skillId,
    host_agent_id: row.hostAgentId,
    kind: row.kind,
    status: row.status,
    snapshot_identity: row.snapshotIdentity,
    model: row.model,
    judge_score: row.judgeScore,
    grounding_pass_rate: row.groundingPassRate,
    cases_passing: row.casesPassing,
    cases_total: row.casesTotal ?? 0,
    cost_usd: row.costUsd,
    ran_at: row.ranAt.toISOString(),
  };
}

/** Map an `eval_runs` row (+ its case) to the per-case batch outcome DTO.
 *  Reads the fine-grained outcome envelope from actualOutput (AC-30) so the
 *  drill-down carries the discriminated status, grounding_missing terms, and
 *  judge evidence — not just a flat pass/fail. */
function runToOutcomeDto(run: EvalRunRow, caseRow: EvalCaseRow) {
  const parsed = parseSkillRunOutput(run.actualOutput);
  const status: 'passed' | 'failed_grounding' | 'failed_judge' | 'error' =
    run.pass === null
      ? 'error'
      : run.pass
        ? 'passed'
        : parsed?.status === 'failed_grounding'
          ? 'failed_grounding'
          : 'failed_judge';
  return {
    case_id: caseRow.id,
    case_name: caseRow.name,
    status,
    grounding_missing: parsed?.grounding_missing ?? [],
    judge_score: parsed?.judge_score ?? null,
    judge_evidence: parsed?.judge_evidence ?? null,
    cost_usd: run.costUsd,
    error_message: run.errorMessage,
  };
}
