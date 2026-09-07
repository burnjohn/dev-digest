import type {
  EvalAgentDetail,
  EvalAgentSummary,
  EvalCallout,
  EvalCase,
  EvalCaseInput,
  EvalCaseMeta,
  EvalCaseOutcome,
  EvalCompare,
  EvalDashboard,
  EvalExpectation,
  EvalLift,
  EvalOwnerKind,
  EvalRun,
  EvalRunAllResult,
  EvalRunEstimate,
  EvalRunRecord,
  EvalSkillCarrier,
  EvalSkillCaseEffect,
  EvalSkillCompare,
  EvalSkillOffer,
  EvalSkillRunEstimate,
  EvalSkillRunRecord,
  EvalSkillSummary,
  EvalTrendPoint,
  LLMProvider,
} from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import {
  EvalRepository,
  type EvalCaseRow,
  type EvalRunRow,
  type SkillForEval,
} from './repository.js';
import { isExpectationGrounded, synthesizeFrozenDiff } from './frozen-input.js';
import {
  classifyEffects,
  computeLift,
  errorCaseOutcome,
  pairArms,
  scoreCase,
  scoreRun,
} from './scoring.js';
import { buildArms, EvalExecutor } from './executor.js';
import { renderSkillBlock } from '../_shared/skill-render.js';
import { diffLines } from './prompt-diff.js';
import { buildCallout } from './callout.js';
import { MAX_FROZEN_DIFF_BYTES, STALE_RUN_TIMEOUT_MS } from './constants.js';
import type {
  AgentLookup,
  AgentRecord,
  CarrierSkillLookup,
  LlmResolver,
  SkillLookup,
} from './ports.js';

/** Pino-compatible subset — no Fastify `app.log` reaches the container
 *  (composition-root boundary); `console` satisfies this, same as
 *  `onboardingService`/`briefService` (`platform/container.ts`). */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface CaseEditInput {
  name?: string;
  notes?: string | null;
  input_diff?: string;
  input_files?: string[];
  input_meta?: EvalCaseMeta;
  expectation?: EvalExpectation;
}

/**
 * specs/15-skill-eval-cases.md AC-26 — `POST /eval/skills/runs/all`'s result.
 * Not a `vendor/shared` contract (§1 lists every contract this plan adds,
 * deliberately not this one) — mirrors `EvalRunAllResult`'s per-owner
 * success/refusal shape one level down, TS-typed only; no route in this
 * module declares a zod `response` schema for anything it returns.
 */
export interface EvalSkillRunAllResult {
  estimate: { skills_total: number; cases_total: number; executions_total: number };
  started: Array<{
    skill_id: string;
    skill_name: string;
    carrier_agent_id: string | null;
    carrier_agent_name: string | null;
    run_id: string | null;
    refused_reason: string | null;
  }>;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Case name default: a slug of the finding title (Approach §5 step 7). */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'eval-case';
}

function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff,
    input_files: row.inputFiles as string[],
    input_meta: row.inputMeta as EvalCaseMeta,
    expectation: row.expectedOutput as EvalExpectation,
    source_finding_id: row.sourceFindingId,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function runRowToEvalRun(row: EvalRunRow): EvalRun {
  return {
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    traces_passed: row.tracesPassed ?? 0,
    traces_total: row.tracesTotal ?? 0,
    cases_errored: row.casesErrored,
    duration_ms: row.durationMs ?? 0,
    cost_usd: row.costUsd,
    per_case: row.perCase,
  };
}

function toEvalRunRecordDto(row: EvalRunRow, agentName: string | null): EvalRunRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    agent_name: agentName,
    status: row.status as EvalRunRecord['status'],
    started_at: row.ranAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    agent_version: row.agentVersion,
    case_ids: row.caseIds,
    metrics: row.status === 'running' ? null : runRowToEvalRun(row),
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    error_reason: row.errorReason,
  };
}

const EMPTY_EFFECT_COUNTS: EvalSkillRunRecord['effect_counts'] = {
  helped: 0,
  hurt: 0,
  no_effect_pass: 0,
  no_effect_fail: 0,
};

function effectCountsOf(effects: EvalSkillCaseEffect[]): EvalSkillRunRecord['effect_counts'] {
  const counts = { ...EMPTY_EFFECT_COUNTS };
  for (const e of effects) counts[e.effect]++;
  return counts;
}

/**
 * R1 — a skill run's `EvalSkillRunRecord` is `EvalRunRecord` (base fields
 * hold the WITH-arm's values by construction) plus the skill-owned identity
 * columns and the lift/effect figures, DERIVED at read time from the two
 * stored arms — never a further persisted column (R1's "a third persisted
 * copy can drift from the arms it claims to summarise"). `agent_name` stays
 * `null` here — this run's owner is a SKILL, not an agent; the carrier's
 * name has its own dedicated field.
 */
function toEvalSkillRunRecordDto(row: EvalRunRow, carrierName: string | null): EvalSkillRunRecord {
  const base = toEvalRunRecordDto(row, null);
  const armWithout = row.armWithout ?? null;
  const withMetrics = base.metrics;
  const lift: EvalLift | null =
    withMetrics && armWithout ? computeLift(withMetrics, armWithout) : null;
  const effects: EvalSkillCaseEffect[] =
    withMetrics && armWithout ? classifyEffects(withMetrics.per_case, armWithout.per_case) : [];
  return {
    ...base,
    skill_version: row.skillVersion,
    carrier_agent_id: row.carrierAgentId,
    carrier_agent_name: carrierName,
    gates_bypassed: row.gatesBypassed,
    arm_without: armWithout,
    lift,
    effects,
    effect_counts: effectCountsOf(effects),
  };
}

function toTrendPoint(row: EvalRunRow): EvalTrendPoint {
  const total = row.tracesTotal ?? 0;
  const passed = row.tracesPassed ?? 0;
  return {
    run_id: row.id,
    ran_at: row.ranAt.toISOString(),
    agent_version: row.agentVersion,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    pass_rate: total > 0 ? passed / total : 0,
    cost_usd: row.costUsd,
  };
}

/** Deltas over an EXPLICIT subset of cases (AC-33) — recomputed with
 *  `scoreRun`, never the stored full-set metrics, so a run whose case set
 *  changed compares apples-to-apples. */
function metricsOverCaseIds(row: EvalRunRow, caseIds: Set<string>): EvalRun {
  const filtered = row.perCase.filter((o) => caseIds.has(o.case_id));
  return scoreRun(filtered, 0);
}

/** Same idea as `metricsOverCaseIds`, over an already-extracted `per_case`
 *  array — used for a skill run's WITHOUT-arm (`arm_without.per_case`),
 *  which isn't a `EvalRunRow` field. */
function metricsOverCaseIdsFrom(perCase: EvalCaseOutcome[], caseIds: Set<string>): EvalRun {
  return scoreRun(
    perCase.filter((o) => caseIds.has(o.case_id)),
    0,
  );
}

function nullableDelta(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : b - a;
}

export class EvalService {
  constructor(
    private repo: EvalRepository,
    private agents: AgentLookup,
    private skills: SkillLookup,
    private resolveLlm: LlmResolver,
    private estimateCost: (model: string, tokensIn: number, tokensOut: number) => number | null,
    private logger: Logger,
    private executor: Pick<EvalExecutor, 'runCase'> = new EvalExecutor(),
    /** specs/15-skill-eval-cases.md §5/§6 — the carrier's FULL linked-skill
     *  set (both gates, `order`) for arm assembly. Optional, with a no-op
     *  default, purely so every pre-existing `new EvalService(...)` call
     *  (agent-only tests, 7 args) keeps compiling; the real
     *  `AgentsRepository.linkedSkills`-backed implementation is wired at
     *  `platform/container.ts`. */
    private carrierSkills: CarrierSkillLookup = { linkedSkills: async () => [] },
    /** D13 — the skill's real per-run token cost, computed with the SAME
     *  renderer (`renderSkillBlock`) and tokenizer the run executor and the
     *  Preview tab use, never a second estimate. Optional/no-op-defaulted
     *  for the same test-compatibility reason as `carrierSkills`. */
    private tokenizer: Pick<Tokenizer, 'count'> = { count: () => 0 },
  ) {}

  // ===========================================================================
  // Case creation, edit, delete (AC-1 … AC-7, AC-12 … AC-14)
  // ===========================================================================

  /** AC-1…AC-7. Returns `created: false` when D17's idempotency applies —
   *  the route maps that to 200 instead of 201. */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ case: EvalCase; created: boolean }> {
    const ctx = await this.repo.findingForCase(workspaceId, findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    if (!ctx.finding.acceptedAt && !ctx.finding.dismissedAt) {
      throw new AppError(
        'finding_not_triaged',
        'Accept or dismiss this finding before turning it into an eval case.',
        422,
      );
    }
    if (!ctx.agentId) {
      throw new AppError(
        'finding_has_no_agent',
        'This finding has no owning agent, so no eval case can be created for it.',
        422,
      );
    }

    // specs/15-skill-eval-cases.md clarification 2 — owner-scoped idempotency
    // read (the composite unique index, §2); behaviour-preserving for the
    // agent path, whose owner is derived from the finding's review either way.
    const existing = await this.repo.getCaseBySourceFindingForOwner(
      workspaceId,
      findingId,
      'agent',
      ctx.agentId,
    );
    if (existing) return { case: toEvalCaseDto(existing), created: false };

    // AC-3/AC-4/D17 tie-break: if both timestamps are set (re-triaged), the
    // LATER one wins — a case is never created from a stale triage state.
    const { acceptedAt, dismissedAt } = ctx.finding;
    const type: EvalExpectation['type'] =
      acceptedAt && dismissedAt
        ? acceptedAt.getTime() >= dismissedAt.getTime()
          ? 'must_find'
          : 'must_not_flag'
        : acceptedAt
          ? 'must_find'
          : 'must_not_flag';

    const patch = await this.repo.filePatch(ctx.prId, ctx.finding.file);
    if (!patch) {
      throw new AppError(
        'no_diff_available',
        `No diff text is available for '${ctx.finding.file}' on this pull request, so no frozen input could be captured.`,
        422,
      );
    }
    const frozenDiff = synthesizeFrozenDiff(ctx.finding.file, patch);
    if (Buffer.byteLength(frozenDiff, 'utf8') > MAX_FROZEN_DIFF_BYTES) {
      throw new AppError(
        'frozen_diff_too_large',
        'This file’s diff is too large to freeze as an eval case.',
        422,
      );
    }

    const expectation: EvalExpectation = {
      type,
      file: ctx.finding.file,
      start_line: ctx.finding.startLine,
      end_line: ctx.finding.endLine,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      title: ctx.finding.title,
    };
    if (!isExpectationGrounded(frozenDiff, expectation)) {
      throw new AppError(
        'expectation_not_grounded',
        'This expectation’s lines do not fall within any hunk of the frozen diff, so no finding could ever match it.',
        422,
      );
    }

    try {
      const row = await this.repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId: ctx.agentId,
        name: slugify(ctx.finding.title),
        inputDiff: frozenDiff,
        inputFiles: [ctx.finding.file],
        inputMeta: { pr_number: ctx.prNumber, title: ctx.prTitle, body: ctx.prBody },
        expectation,
        notes: null,
        sourceFindingId: findingId,
      });
      return { case: toEvalCaseDto(row), created: true };
    } catch (err) {
      // D17 belt-and-braces: a race between two rapid clicks both passing
      // the pre-check above resolves to the SAME case, never a 500.
      if (isUniqueViolation(err)) {
        const race = await this.repo.getCaseBySourceFindingForOwner(
          workspaceId,
          findingId,
          'agent',
          ctx.agentId,
        );
        if (race) return { case: toEvalCaseDto(race), created: false };
      }
      throw err;
    }
  }

  // ===========================================================================
  // specs/15-skill-eval-cases.md — skill-owned case creation (AC-1 … AC-10)
  // ===========================================================================

  /** AC-2 — the offer list: only skills the finding's own review PROVABLY
   *  injected (`run_skills`), never every skill linked to the finding's
   *  agent. `has_case` surfaces AC-1's idempotency before the click. */
  async listSkillOffersForFinding(workspaceId: string, findingId: string): Promise<EvalSkillOffer[]> {
    const injected = await this.repo.skillsInjectedForFinding(workspaceId, findingId);
    const offers: EvalSkillOffer[] = [];
    for (const s of injected) {
      const existing = await this.repo.getCaseBySourceFindingForOwner(
        workspaceId,
        findingId,
        'skill',
        s.skillId,
      );
      offers.push({ skill_id: s.skillId, skill_name: s.skillName, has_case: !!existing });
    }
    return offers;
  }

  /**
   * AC-1, AC-3 … AC-7, AC-9 — a near-copy of `createCaseFromFinding` with
   * four differences (D9/D10): the skill must have been actually injected
   * into the finding's review (AC-2, else 422); the owner is `('skill',
   * skillId)`; idempotency and the 23505 belt-and-braces re-read are both
   * owner-scoped. Everything else — triage-derived expectation type
   * including the re-triage tie-break, `synthesizeFrozenDiff`,
   * `MAX_FROZEN_DIFF_BYTES`, `isExpectationGrounded` — is reused verbatim.
   */
  async createCaseFromFindingForSkill(
    workspaceId: string,
    findingId: string,
    skillId: string,
  ): Promise<{ case: EvalCase; created: boolean }> {
    const ctx = await this.repo.findingForCase(workspaceId, findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    if (!ctx.finding.acceptedAt && !ctx.finding.dismissedAt) {
      throw new AppError(
        'finding_not_triaged',
        'Accept or dismiss this finding before turning it into an eval case.',
        422,
      );
    }

    const injected = await this.repo.skillsInjectedForFinding(workspaceId, findingId);
    if (!injected.some((s) => s.skillId === skillId)) {
      throw new AppError(
        'skill_not_injected',
        'This skill was not present in the prompt of the review that produced this finding.',
        422,
      );
    }

    const existing = await this.repo.getCaseBySourceFindingForOwner(
      workspaceId,
      findingId,
      'skill',
      skillId,
    );
    if (existing) return { case: toEvalCaseDto(existing), created: false };

    // AC-3/AC-4/D17 tie-break: if both timestamps are set (re-triaged), the
    // LATER one wins — a case is never created from a stale triage state.
    const { acceptedAt, dismissedAt } = ctx.finding;
    const type: EvalExpectation['type'] =
      acceptedAt && dismissedAt
        ? acceptedAt.getTime() >= dismissedAt.getTime()
          ? 'must_find'
          : 'must_not_flag'
        : acceptedAt
          ? 'must_find'
          : 'must_not_flag';

    const patch = await this.repo.filePatch(ctx.prId, ctx.finding.file);
    if (!patch) {
      throw new AppError(
        'no_diff_available',
        `No diff text is available for '${ctx.finding.file}' on this pull request, so no frozen input could be captured.`,
        422,
      );
    }
    const frozenDiff = synthesizeFrozenDiff(ctx.finding.file, patch);
    if (Buffer.byteLength(frozenDiff, 'utf8') > MAX_FROZEN_DIFF_BYTES) {
      throw new AppError(
        'frozen_diff_too_large',
        'This file’s diff is too large to freeze as an eval case.',
        422,
      );
    }

    const expectation: EvalExpectation = {
      type,
      file: ctx.finding.file,
      start_line: ctx.finding.startLine,
      end_line: ctx.finding.endLine,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      title: ctx.finding.title,
    };
    if (!isExpectationGrounded(frozenDiff, expectation)) {
      throw new AppError(
        'expectation_not_grounded',
        'This expectation’s lines do not fall within any hunk of the frozen diff, so no finding could ever match it.',
        422,
      );
    }

    try {
      const row = await this.repo.insertCase({
        workspaceId,
        ownerKind: 'skill',
        ownerId: skillId,
        name: slugify(ctx.finding.title),
        inputDiff: frozenDiff,
        inputFiles: [ctx.finding.file],
        inputMeta: { pr_number: ctx.prNumber, title: ctx.prTitle, body: ctx.prBody },
        expectation,
        notes: null,
        sourceFindingId: findingId,
      });
      return { case: toEvalCaseDto(row), created: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const race = await this.repo.getCaseBySourceFindingForOwner(
          workspaceId,
          findingId,
          'skill',
          skillId,
        );
        if (race) return { case: toEvalCaseDto(race), created: false };
      }
      throw err;
    }
  }

  /** AC-8's hand-authored path — a never-run (newly created/imported) skill
   *  has no findings to draw a case from. Runs the SAME size cap and
   *  `isExpectationGrounded` check as `updateCase` (AC-9/AC-10 hold
   *  identically on both creation paths). */
  async createSkillCase(
    workspaceId: string,
    skillId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase> {
    const skill = await this.repo.skillForEval(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    if (Buffer.byteLength(input.input_diff, 'utf8') > MAX_FROZEN_DIFF_BYTES) {
      throw new AppError(
        'frozen_diff_too_large',
        'This file’s diff is too large to freeze as an eval case.',
        422,
      );
    }
    if (!isExpectationGrounded(input.input_diff, input.expectation)) {
      throw new AppError(
        'expectation_not_grounded',
        'This expectation’s lines do not fall within any hunk of the supplied diff.',
        422,
      );
    }

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'skill',
      ownerId: skillId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectation: input.expectation,
      notes: input.notes ?? null,
      sourceFindingId: null,
    });
    return toEvalCaseDto(row);
  }

  async listCases(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<EvalCase[]> {
    const rows = await this.repo.listCasesForOwner(workspaceId, ownerKind, ownerId);
    return rows.map(toEvalCaseDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCase(workspaceId, id);
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** AC-12/AC-13 — re-runs the same frozen-input/grounding validation
   *  (`createCaseFromFinding` steps 5–6) on whatever changed. AC-14: never
   *  touches `eval_runs`. */
  async updateCase(
    workspaceId: string,
    id: string,
    patch: CaseEditInput,
  ): Promise<EvalCase | undefined> {
    const existing = await this.repo.getCase(workspaceId, id);
    if (!existing) return undefined;

    const nextDiff = patch.input_diff ?? existing.inputDiff;
    const nextExpectation = patch.expectation ?? (existing.expectedOutput as EvalExpectation);
    if (patch.input_diff !== undefined || patch.expectation !== undefined) {
      if (Buffer.byteLength(nextDiff, 'utf8') > MAX_FROZEN_DIFF_BYTES) {
        throw new AppError(
          'frozen_diff_too_large',
          'This file’s diff is too large to freeze as an eval case.',
          422,
        );
      }
      if (!isExpectationGrounded(nextDiff, nextExpectation)) {
        throw new AppError(
          'expectation_not_grounded',
          'This expectation’s lines do not fall within any hunk of the frozen diff, so no finding could ever match it.',
          422,
        );
      }
    }

    const row = await this.repo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expectation !== undefined ? { expectation: patch.expectation } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  // ===========================================================================
  // Run lifecycle (AC-8, AC-11, AC-15, AC-23 … AC-28, AC-49)
  // ===========================================================================

  async estimate(workspaceId: string, agentId: string): Promise<EvalRunEstimate> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    return { agents_total: 1, cases_total: cases.length, executions_total: cases.length };
  }

  /** AC-8, AC-15, AC-24, AC-49. Returns immediately with the run id; the
   *  slow part runs in the background (`reviews/service.ts:171` precedent). */
  async startRun(
    workspaceId: string,
    agentId: string,
  ): Promise<{ run_id: string; status: 'running'; estimate: EvalRunEstimate }> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // D19 — reconcile this owner's stale `running` rows BEFORE the AC-15
    // guard, so a restart can never deadlock this agent's runs.
    await this.repo.reconcileStaleRunning(new Date(Date.now() - STALE_RUN_TIMEOUT_MS), {
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
    });

    const active = await this.repo.activeRunForOwner(workspaceId, 'agent', agentId);
    if (active) {
      throw new AppError(
        'run_in_flight',
        'An eval run is already in progress for this agent.',
        409,
      );
    }

    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    if (cases.length === 0) {
      throw new AppError('no_cases', 'This agent has no eval cases to run.', 422);
    }

    // finding 9 — resolve the LLM BEFORE creating the run row, translating
    // `ConfigError` (HTTP 500 by default) into a stated 422 with no orphan
    // run record left behind.
    let llm: LLMProvider;
    try {
      llm = await this.resolveLlm(agent.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'provider_not_configured',
          `No API key is configured for provider '${agent.provider}'.`,
          422,
        );
      }
      throw err;
    }

    const estimateResult: EvalRunEstimate = {
      agents_total: 1,
      cases_total: cases.length,
      executions_total: cases.length,
    };
    const run = await this.repo.insertRun({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      agentVersion: agent.version,
      caseIds: cases.map((c) => c.id),
    });

    void this.executeRun(workspaceId, agent, llm, run.id, cases).catch((err) => {
      this.logger.error({ runId: run.id, err: (err as Error).message }, 'eval: background execution crashed');
    });

    return { run_id: run.id, status: 'running', estimate: estimateResult };
  }

  private async executeRun(
    _workspaceId: string,
    agent: AgentRecord,
    llm: LLMProvider,
    runId: string,
    cases: EvalCaseRow[],
  ): Promise<void> {
    const started = Date.now();
    const outcomes: ReturnType<typeof scoreCase>[] = [];
    try {
      const skillBlocks = await this.skills.enabledSkills(agent.id);
      for (const c of cases) {
        const caseStarted = Date.now();
        const expectation = c.expectedOutput as EvalExpectation;
        try {
          const result = await this.executor.runCase(agent, skillBlocks, llm, {
            inputDiff: c.inputDiff,
            inputMeta: c.inputMeta as EvalCaseMeta,
          });
          outcomes.push(
            scoreCase({
              caseId: c.id,
              name: c.name,
              expectation,
              findings: result.findings,
              groundingKept: result.groundingKept,
              groundingTotal: result.groundingTotal,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
            }),
          );
        } catch (err) {
          // AC-11 — a per-case failure completes the run; the case is
          // marked errored and excluded from every metric.
          outcomes.push(
            errorCaseOutcome(
              c.id,
              c.name,
              expectation.type,
              (err as Error).message,
              Date.now() - caseStarted,
            ),
          );
        }
      }

      const metrics = scoreRun(outcomes, Date.now() - started);
      await this.repo.completeRun(runId, {
        status: 'completed',
        perCase: metrics.per_case,
        casesErrored: metrics.cases_errored,
        tracesPassed: metrics.traces_passed,
        tracesTotal: metrics.traces_total,
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citation_accuracy,
        durationMs: metrics.duration_ms,
        costUsd: metrics.cost_usd,
      });
      // Privacy of logs — counts/metrics/model/cost only, NEVER diff,
      // expectation or finding prose.
      this.logger.info(
        {
          runId,
          agentId: agent.id,
          casesTotal: cases.length,
          casesErrored: metrics.cases_errored,
          recall: metrics.recall,
          precision: metrics.precision,
          citationAccuracy: metrics.citation_accuracy,
          model: agent.model,
          durationMs: metrics.duration_ms,
          costUsd: metrics.cost_usd,
        },
        'eval run completed',
      );
    } catch (err) {
      // A crash of the whole loop (not a per-case failure) — the run is
      // never left `running`.
      await this.repo.completeRun(runId, {
        status: 'errored',
        perCase: outcomes,
        casesErrored: outcomes.length,
        tracesPassed: null,
        tracesTotal: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: Date.now() - started,
        costUsd: null,
        errorReason: (err as Error).message,
      });
      this.logger.error({ runId, err: (err as Error).message }, 'eval run crashed');
    }
  }

  /** AC-25/AC-42 — per-agent progress/failure, never one combined result.
   *  The route's zod body (`confirm: z.literal(true)`) is what enforces
   *  AC-25's "no execution until confirmation" — by the time this runs,
   *  confirmation has already been given. */
  async runAll(workspaceId: string): Promise<EvalRunAllResult> {
    const agents = await this.agents.listEnabled(workspaceId);
    const relevant: { id: string; name: string; cases: number }[] = [];
    for (const agent of agents) {
      const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agent.id);
      if (cases.length > 0) relevant.push({ id: agent.id, name: agent.name, cases: cases.length });
    }

    const started: EvalRunAllResult['started'] = [];
    let executionsTotal = 0;
    let casesTotal = 0;
    for (const agent of relevant) {
      casesTotal += agent.cases;
      try {
        const result = await this.startRun(workspaceId, agent.id);
        executionsTotal += result.estimate.executions_total;
        started.push({
          agent_id: agent.id,
          agent_name: agent.name,
          run_id: result.run_id,
          refused_reason: null,
        });
      } catch (err) {
        started.push({
          agent_id: agent.id,
          agent_name: agent.name,
          run_id: null,
          refused_reason: err instanceof AppError ? err.message : 'Failed to start this agent’s run.',
        });
      }
    }

    return {
      estimate: { agents_total: relevant.length, cases_total: casesTotal, executions_total: executionsTotal },
      started,
    };
  }

  /** specs/15-skill-eval-cases.md §7 — owner-agnostic: returns the widened
   *  `EvalSkillRunRecord` (a structural superset of `EvalRunRecord`) when the
   *  row's `owner_kind` is `'skill'`, unchanged agent-run behaviour otherwise. */
  async getRun(workspaceId: string, id: string): Promise<EvalRunRecord | undefined> {
    const row = await this.repo.getRun(workspaceId, id);
    if (!row) return undefined;
    if (row.ownerKind === 'skill') {
      const carrier = row.carrierAgentId ? await this.agents.getById(workspaceId, row.carrierAgentId) : null;
      return toEvalSkillRunRecordDto(row, carrier?.name ?? null);
    }
    const agent = await this.agents.getById(workspaceId, row.ownerId);
    return toEvalRunRecordDto(row, agent?.name ?? null);
  }

  async listRuns(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listRunsForOwner(workspaceId, 'agent', agentId);
    return rows.map((r) => toEvalRunRecordDto(r, agent.name));
  }

  // ===========================================================================
  // specs/15-skill-eval-cases.md — running a two-armed suite (AC-11 … AC-28)
  // ===========================================================================

  /** AC-11 — the carrier picker's options, carrying both gate states so the
   *  surface can state D8's bypass without a second round-trip. */
  async listSkillCarriers(workspaceId: string, skillId: string): Promise<EvalSkillCarrier[]> {
    const skill = await this.repo.skillForEval(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const carriers = await this.repo.carriersForSkill(workspaceId, skillId);
    return carriers.map((c) => ({
      agent_id: c.agentId,
      agent_name: c.agentName,
      skill_enabled: skill.enabled,
      link_enabled: c.linkEnabled,
    }));
  }

  /** AC-25 — `executions_total` is `2 × cases_total`, stated before any
   *  execution starts. */
  async skillEstimate(
    workspaceId: string,
    skillId: string,
    carrierId: string,
  ): Promise<EvalSkillRunEstimate> {
    const skill = await this.repo.skillForEval(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const carrier = await this.agents.getById(workspaceId, carrierId);
    if (!carrier) throw new NotFoundError('Agent not found');
    const carriers = await this.repo.carriersForSkill(workspaceId, skillId);
    const link = carriers.find((c) => c.agentId === carrierId);
    if (!link) {
      throw new AppError('no_agent_linked', 'This agent is not linked to this skill.', 422);
    }
    const cases = await this.repo.listCasesForOwner(workspaceId, 'skill', skillId);
    return {
      cases_total: cases.length,
      executions_total: cases.length * 2,
      carrier_agent_id: carrier.id,
      carrier_agent_name: carrier.name,
      gates_bypassed: !(skill.enabled && link.linkEnabled),
    };
  }

  /**
   * AC-8, AC-11, AC-15, AC-24, AC-49 — order matters and is itself an AC:
   * 1. resolve the skill AND the carrier, workspace-scoped, BEFORE any case
   *    row is read (AC-53's verify clause — a cross-workspace carrier is
   *    refused here, before step 4 ever reads a case);
   * 2. reconcile this owner's stale `running` rows BEFORE the in-flight
   *    guard (D19/AC-15, mirroring the agent path);
   * 3. the in-flight guard (AC-14);
   * 4. empty case set / no linked agent → 422 (AC-49);
   * 5. resolve the LLM BEFORE inserting the run row, so a `ConfigError`
   *    (translated to a stated 422) leaves no orphan run row (AC-49);
   * 6. insert the run with the skill-owned identity columns;
   * 7. return 202 and execute in the background, exactly as the agent path.
   */
  async startSkillRun(
    workspaceId: string,
    skillId: string,
    carrierId: string,
  ): Promise<{ run_id: string; status: 'running'; estimate: EvalSkillRunEstimate }> {
    // 1
    const skill = await this.repo.skillForEval(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const carrier = await this.agents.getById(workspaceId, carrierId);
    if (!carrier) throw new NotFoundError('Agent not found');

    // 2 — D19
    await this.repo.reconcileStaleRunning(new Date(Date.now() - STALE_RUN_TIMEOUT_MS), {
      workspaceId,
      ownerKind: 'skill',
      ownerId: skillId,
    });

    // 3 — AC-14
    const active = await this.repo.activeRunForOwner(workspaceId, 'skill', skillId);
    if (active) {
      throw new AppError('run_in_flight', 'An eval run is already in progress for this skill.', 409);
    }

    // 4 — AC-49
    const cases = await this.repo.listCasesForOwner(workspaceId, 'skill', skillId);
    if (cases.length === 0) {
      throw new AppError('no_cases', 'This skill has no eval cases to run.', 422);
    }
    const carriers = await this.repo.carriersForSkill(workspaceId, skillId);
    const link = carriers.find((c) => c.agentId === carrierId);
    if (!link) {
      throw new AppError('no_agent_linked', 'This agent is not linked to this skill.', 422);
    }

    // 5
    let llm: LLMProvider;
    try {
      llm = await this.resolveLlm(carrier.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'provider_not_configured',
          `No API key is configured for provider '${carrier.provider}'.`,
          422,
        );
      }
      throw err;
    }

    // D8/AC-52 — true when EITHER gate is currently off for this skill/carrier.
    const gatesBypassed = !(skill.enabled && link.linkEnabled);
    const estimateResult: EvalSkillRunEstimate = {
      cases_total: cases.length,
      executions_total: cases.length * 2,
      carrier_agent_id: carrier.id,
      carrier_agent_name: carrier.name,
      gates_bypassed: gatesBypassed,
    };

    // 6
    const run = await this.repo.insertRun({
      workspaceId,
      ownerKind: 'skill',
      ownerId: skillId,
      agentVersion: carrier.version,
      caseIds: cases.map((c) => c.id),
      skillVersion: skill.version,
      carrierAgentId: carrier.id,
      gatesBypassed,
    });

    // 7
    void this.executeSkillRun(skill, carrier, link.order, llm, run.id, cases).catch((err) => {
      this.logger.error(
        { runId: run.id, err: (err as Error).message },
        'eval: skill background execution crashed',
      );
    });

    return { run_id: run.id, status: 'running', estimate: estimateResult };
  }

  /**
   * AC-12, AC-16, AC-23, AC-24 — per case: `runCase` with the with-arm, then
   * with the without-arm, each wrapped in its OWN try/catch producing
   * `errorCaseOutcome`. Then `pairArms` (excludes a case errored in either
   * arm from BOTH) → `scoreRun` on each paired arm → `computeLift` →
   * `classifyEffects` → `completeRun`, storing the with-arm in the existing
   * columns (unchanged shape, R1) and the without-arm's whole `EvalRun` in
   * `arm_without`.
   */
  private async executeSkillRun(
    skill: SkillForEval,
    carrier: AgentRecord,
    linkOrder: number,
    llm: LLMProvider,
    runId: string,
    cases: EvalCaseRow[],
  ): Promise<void> {
    const started = Date.now();
    const withOutcomes: EvalCaseOutcome[] = [];
    const withoutOutcomes: EvalCaseOutcome[] = [];

    try {
      const carrierLinks = await this.carrierSkills.linkedSkills(carrier.id);
      const { withArm, withoutArm } = buildArms(
        carrierLinks,
        { id: skill.id, name: skill.name, type: skill.type, body: skill.body },
        linkOrder,
      );

      for (const c of cases) {
        const expectation = c.expectedOutput as EvalExpectation;
        const caseInput = {
          inputDiff: c.inputDiff,
          inputMeta: c.inputMeta as EvalCaseMeta,
        };

        const withStarted = Date.now();
        try {
          const result = await this.executor.runCase(carrier, withArm, llm, caseInput);
          withOutcomes.push(
            scoreCase({
              caseId: c.id,
              name: c.name,
              expectation,
              findings: result.findings,
              groundingKept: result.groundingKept,
              groundingTotal: result.groundingTotal,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
            }),
          );
        } catch (err) {
          withOutcomes.push(
            errorCaseOutcome(
              c.id,
              c.name,
              expectation.type,
              (err as Error).message,
              Date.now() - withStarted,
            ),
          );
        }

        const withoutStarted = Date.now();
        try {
          const result = await this.executor.runCase(carrier, withoutArm, llm, caseInput);
          withoutOutcomes.push(
            scoreCase({
              caseId: c.id,
              name: c.name,
              expectation,
              findings: result.findings,
              groundingKept: result.groundingKept,
              groundingTotal: result.groundingTotal,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
            }),
          );
        } catch (err) {
          withoutOutcomes.push(
            errorCaseOutcome(
              c.id,
              c.name,
              expectation.type,
              (err as Error).message,
              Date.now() - withoutStarted,
            ),
          );
        }
      }

      // AC-23 — a case errored in either arm is excluded from BOTH.
      const paired = pairArms(withOutcomes, withoutOutcomes);
      const durationMs = Date.now() - started;
      const withMetrics = scoreRun(paired.with, durationMs);
      const withoutMetrics = scoreRun(paired.without, durationMs);
      const costUsd =
        withMetrics.cost_usd == null || withoutMetrics.cost_usd == null
          ? null
          : withMetrics.cost_usd + withoutMetrics.cost_usd;

      await this.repo.completeRun(runId, {
        status: 'completed',
        perCase: withMetrics.per_case,
        casesErrored: withMetrics.cases_errored,
        tracesPassed: withMetrics.traces_passed,
        tracesTotal: withMetrics.traces_total,
        recall: withMetrics.recall,
        precision: withMetrics.precision,
        citationAccuracy: withMetrics.citation_accuracy,
        durationMs: withMetrics.duration_ms,
        costUsd,
        armWithout: withoutMetrics,
      });

      // Privacy of logs (SPEC-15 §Privacy of logs) — counts/ids/versions/
      // model/cost only, NEVER diff, skill body, expectation or finding prose.
      const effects = classifyEffects(paired.with, paired.without);
      this.logger.info(
        {
          runId,
          skillId: skill.id,
          skillVersion: skill.version,
          carrierAgentId: carrier.id,
          casesTotal: cases.length,
          casesErrored: withMetrics.cases_errored,
          casesHelped: effects.filter((e) => e.effect === 'helped').length,
          casesHurt: effects.filter((e) => e.effect === 'hurt').length,
          recall: withMetrics.recall,
          precision: withMetrics.precision,
          citationAccuracy: withMetrics.citation_accuracy,
          model: carrier.model,
          durationMs: withMetrics.duration_ms,
          costUsd,
        },
        'skill eval run completed',
      );
    } catch (err) {
      // A crash of the whole loop (not a per-case failure) — the run is
      // never left `running`.
      await this.repo.completeRun(runId, {
        status: 'errored',
        perCase: withOutcomes,
        casesErrored: withOutcomes.length,
        tracesPassed: null,
        tracesTotal: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: Date.now() - started,
        costUsd: null,
        errorReason: (err as Error).message,
      });
      this.logger.error({ runId, err: (err as Error).message }, 'skill eval run crashed');
    }
  }

  async listSkillRuns(workspaceId: string, skillId: string): Promise<EvalSkillRunRecord[]> {
    const skill = await this.repo.skillForEval(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    const rows = await this.repo.listRunsForOwner(workspaceId, 'skill', skillId);
    const carrierNames = await this.carrierNamesFor(workspaceId, rows);
    return rows.map((r) =>
      toEvalSkillRunRecordDto(r, r.carrierAgentId ? (carrierNames.get(r.carrierAgentId) ?? null) : null),
    );
  }

  /** R5 — run every skill owning ≥1 case, auto-selecting a carrier per skill
   *  (the linked agent with the lowest `agent_skills.order`, ties broken by
   *  agent name — `carriersForSkill`'s own ordering already implements this
   *  tie-break). A skill with zero linked agents is skipped with a stated
   *  reason, reusing `runAll`'s per-owner refusal shape. */
  async runAllSkills(workspaceId: string): Promise<EvalSkillRunAllResult> {
    const skillIds = await this.repo.ownersWithCases(workspaceId, 'skill');
    const started: EvalSkillRunAllResult['started'] = [];
    let executionsTotal = 0;
    let casesTotal = 0;

    for (const skillId of skillIds) {
      const skill = await this.repo.skillForEval(workspaceId, skillId);
      if (!skill) continue;
      const cases = await this.repo.listCasesForOwner(workspaceId, 'skill', skillId);
      if (cases.length === 0) continue;
      casesTotal += cases.length;

      const carriers = await this.repo.carriersForSkill(workspaceId, skillId);
      if (carriers.length === 0) {
        started.push({
          skill_id: skillId,
          skill_name: skill.name,
          carrier_agent_id: null,
          carrier_agent_name: null,
          run_id: null,
          refused_reason: 'No agent is linked to this skill.',
        });
        continue;
      }
      const carrier = carriers[0]!;

      try {
        const result = await this.startSkillRun(workspaceId, skillId, carrier.agentId);
        executionsTotal += result.estimate.executions_total;
        started.push({
          skill_id: skillId,
          skill_name: skill.name,
          carrier_agent_id: carrier.agentId,
          carrier_agent_name: carrier.agentName,
          run_id: result.run_id,
          refused_reason: null,
        });
      } catch (err) {
        started.push({
          skill_id: skillId,
          skill_name: skill.name,
          carrier_agent_id: carrier.agentId,
          carrier_agent_name: carrier.agentName,
          run_id: null,
          refused_reason: err instanceof AppError ? err.message : 'Failed to start this skill’s run.',
        });
      }
    }

    return {
      estimate: {
        skills_total: skillIds.length,
        cases_total: casesTotal,
        executions_total: executionsTotal,
      },
      started,
    };
  }

  /** Batched carrier-name lookup for a list of skill runs — avoids one
   *  `agents.getById` round trip per row. */
  private async carrierNamesFor(
    workspaceId: string,
    rows: EvalRunRow[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.carrierAgentId).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    for (const id of ids) {
      const agent = await this.agents.getById(workspaceId, id);
      if (agent) names.set(id, agent.name);
    }
    return names;
  }

  // ===========================================================================
  // Compare (AC-32 … AC-34)
  // ===========================================================================

  async compare(workspaceId: string, a: string, b: string): Promise<EvalCompare> {
    if (a === b) {
      throw new AppError('invalid_compare', 'Select two distinct runs to compare.', 422);
    }
    const [runA, runB] = await Promise.all([
      this.repo.getRun(workspaceId, a),
      this.repo.getRun(workspaceId, b),
    ]);
    if (!runA || !runB) throw new NotFoundError('Eval run not found');
    if (runA.ownerKind !== runB.ownerKind || runA.ownerId !== runB.ownerId) {
      throw new AppError('invalid_compare', 'Both runs must belong to the same agent.', 422);
    }

    const [older, newer] = runA.ranAt.getTime() <= runB.ranAt.getTime() ? [runA, runB] : [runB, runA];
    const oldIds = new Set(older.caseIds);
    const newIds = new Set(newer.caseIds);
    const common_case_ids = older.caseIds.filter((id) => newIds.has(id));
    const only_in_old = older.caseIds.filter((id) => !newIds.has(id));
    const only_in_new = newer.caseIds.filter((id) => !oldIds.has(id));

    const commonSet = new Set(common_case_ids);
    const oldMetrics = metricsOverCaseIds(older, commonSet);
    const newMetrics = metricsOverCaseIds(newer, commonSet);
    const deltas = {
      recall: nullableDelta(oldMetrics.recall, newMetrics.recall),
      precision: nullableDelta(oldMetrics.precision, newMetrics.precision),
      citation_accuracy: nullableDelta(oldMetrics.citation_accuracy, newMetrics.citation_accuracy),
    };

    let prompt_diff: EvalCompare['prompt_diff'] = [];
    if (older.agentVersion != null && newer.agentVersion != null) {
      const [oldPrompt, newPrompt] = await Promise.all([
        this.repo.agentVersionPrompt(older.ownerId, older.agentVersion),
        this.repo.agentVersionPrompt(newer.ownerId, newer.agentVersion),
      ]);
      if (oldPrompt !== undefined && newPrompt !== undefined) {
        prompt_diff = diffLines(oldPrompt, newPrompt);
      }
    }

    const agent = await this.agents.getById(workspaceId, older.ownerId);
    return {
      old: toEvalRunRecordDto(older, agent?.name ?? null),
      new: toEvalRunRecordDto(newer, agent?.name ?? null),
      common_case_ids,
      only_in_old,
      only_in_new,
      deltas,
      prompt_diff,
    };
  }

  /**
   * AC-32/AC-33 — two SKILL-owned runs of the same skill. `carrier_differs`
   * is the second axis SPEC-15 adds beside the inherited case-set-difference
   * guard; `lift_deltas` recomputes each run's OWN lift over the common case
   * set (from each run's own `arm_without`), never the stored full-set lift;
   * `skill_body_diff` reuses `diffLines` over the two `skillVersionBody` reads.
   */
  async skillCompare(workspaceId: string, a: string, b: string): Promise<EvalSkillCompare> {
    if (a === b) {
      throw new AppError('invalid_compare', 'Select two distinct runs to compare.', 422);
    }
    const [runA, runB] = await Promise.all([
      this.repo.getRun(workspaceId, a),
      this.repo.getRun(workspaceId, b),
    ]);
    if (!runA || !runB) throw new NotFoundError('Eval run not found');
    if (runA.ownerKind !== 'skill' || runB.ownerKind !== 'skill') {
      throw new AppError('invalid_compare', 'Both runs must be skill-owned eval runs.', 422);
    }
    if (runA.ownerId !== runB.ownerId) {
      throw new AppError('invalid_compare', 'Both runs must belong to the same skill.', 422);
    }

    const [older, newer] = runA.ranAt.getTime() <= runB.ranAt.getTime() ? [runA, runB] : [runB, runA];
    const oldIds = new Set(older.caseIds);
    const newIds = new Set(newer.caseIds);
    const common_case_ids = older.caseIds.filter((id) => newIds.has(id));
    const only_in_old = older.caseIds.filter((id) => !newIds.has(id));
    const only_in_new = newer.caseIds.filter((id) => !oldIds.has(id));

    const commonSet = new Set(common_case_ids);
    const oldMetrics = metricsOverCaseIds(older, commonSet);
    const newMetrics = metricsOverCaseIds(newer, commonSet);
    const deltas = {
      recall: nullableDelta(oldMetrics.recall, newMetrics.recall),
      precision: nullableDelta(oldMetrics.precision, newMetrics.precision),
      citation_accuracy: nullableDelta(oldMetrics.citation_accuracy, newMetrics.citation_accuracy),
    };

    const oldWithoutOverCommon = older.armWithout
      ? metricsOverCaseIdsFrom(older.armWithout.per_case, commonSet)
      : null;
    const newWithoutOverCommon = newer.armWithout
      ? metricsOverCaseIdsFrom(newer.armWithout.per_case, commonSet)
      : null;
    const oldLift = oldWithoutOverCommon ? computeLift(oldMetrics, oldWithoutOverCommon) : null;
    const newLift = newWithoutOverCommon ? computeLift(newMetrics, newWithoutOverCommon) : null;
    const lift_deltas = {
      recall: oldLift && newLift ? nullableDelta(oldLift.recall, newLift.recall) : null,
      precision: oldLift && newLift ? nullableDelta(oldLift.precision, newLift.precision) : null,
      citation_accuracy:
        oldLift && newLift ? nullableDelta(oldLift.citation_accuracy, newLift.citation_accuracy) : null,
    };

    const carrier_differs = older.carrierAgentId !== newer.carrierAgentId;

    let skill_body_diff: EvalSkillCompare['skill_body_diff'] = [];
    if (older.skillVersion != null && newer.skillVersion != null) {
      const [oldBody, newBody] = await Promise.all([
        this.repo.skillVersionBody(workspaceId, older.ownerId, older.skillVersion),
        this.repo.skillVersionBody(workspaceId, newer.ownerId, newer.skillVersion),
      ]);
      if (oldBody !== undefined && newBody !== undefined) {
        skill_body_diff = diffLines(oldBody, newBody);
      }
    }

    const [olderCarrier, newerCarrier] = await Promise.all([
      older.carrierAgentId ? this.agents.getById(workspaceId, older.carrierAgentId) : null,
      newer.carrierAgentId ? this.agents.getById(workspaceId, newer.carrierAgentId) : null,
    ]);

    return {
      old: toEvalSkillRunRecordDto(older, olderCarrier?.name ?? null),
      new: toEvalSkillRunRecordDto(newer, newerCarrier?.name ?? null),
      common_case_ids,
      only_in_old,
      only_in_new,
      carrier_differs,
      deltas,
      lift_deltas,
      skill_body_diff,
    };
  }

  // ===========================================================================
  // Dashboard + agent detail (AC-40 … AC-48)
  // ===========================================================================

  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const agents = await this.agents.listEnabled(workspaceId);
    const summaries: EvalAgentSummary[] = [];
    for (const agent of agents) {
      const [cases, runs] = await Promise.all([
        this.repo.listCasesForOwner(workspaceId, 'agent', agent.id),
        this.repo.listRunsForOwner(workspaceId, 'agent', agent.id),
      ]);
      const completed = runs.filter((r) => r.status === 'completed');
      summaries.push({
        agent_id: agent.id,
        agent_name: agent.name,
        cases_total: cases.length,
        latest: runs[0] ? toEvalRunRecordDto(runs[0], agent.name) : null,
        trend: completed
          .slice()
          .reverse()
          .map(toTrendPoint),
      });
    }

    const recentRows = await this.repo.listRecentRuns(workspaceId, 20);
    const nameById = new Map(agents.map((a) => [a.id, a.name]));
    const recent_runs = recentRows.map((r) => toEvalRunRecordDto(r, nameById.get(r.ownerId) ?? null));

    // specs/15-skill-eval-cases.md AC-39 — skills owning ≥1 case, in their
    // OWN section (never merged into `agents` above — N9/AC-40).
    const skillIds = await this.repo.ownersWithCases(workspaceId, 'skill');
    const skills: EvalSkillSummary[] = [];
    for (const skillId of skillIds) {
      const skill = await this.repo.skillForEval(workspaceId, skillId);
      if (!skill) continue; // deleted between the list read and this read
      const [cases, runs] = await Promise.all([
        this.repo.listCasesForOwner(workspaceId, 'skill', skillId),
        this.repo.listRunsForOwner(workspaceId, 'skill', skillId),
      ]);
      const latestRow = runs[0];
      const carrier =
        latestRow?.carrierAgentId != null
          ? await this.agents.getById(workspaceId, latestRow.carrierAgentId)
          : null;
      skills.push({
        skill_id: skillId,
        skill_name: skill.name,
        cases_total: cases.length,
        carrier_agent_name: carrier?.name ?? null,
        latest: latestRow ? toEvalSkillRunRecordDto(latestRow, carrier?.name ?? null) : null,
        // D13 — the same renderer + tokenizer the run executor and the
        // Preview tab use, read directly (never through `SkillsService` —
        // `no-cross-module`).
        tokens_per_run: this.tokenizer.count(
          renderSkillBlock({ name: skill.name, type: skill.type, body: skill.body }),
        ),
      });
    }

    return { agents: summaries, recent_runs, skills };
  }

  async agentDetail(workspaceId: string, agentId: string): Promise<EvalAgentDetail> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [cases, runs] = await Promise.all([
      this.repo.listCasesForOwner(workspaceId, 'agent', agentId),
      this.repo.listRunsForOwner(workspaceId, 'agent', agentId),
    ]);
    const completed = runs.filter((r) => r.status === 'completed');

    const current = completed[0] ? runRowToEvalRun(completed[0]) : null;
    const delta =
      completed.length >= 2
        ? {
            recall: nullableDelta(completed[1]!.recall, completed[0]!.recall),
            precision: nullableDelta(completed[1]!.precision, completed[0]!.precision),
            citation_accuracy: nullableDelta(
              completed[1]!.citationAccuracy,
              completed[0]!.citationAccuracy,
            ),
          }
        : null;
    const callout: EvalCallout | null =
      completed.length >= 2
        ? buildCallout(
            { metrics: runRowToEvalRun(completed[0]!), agentVersion: completed[0]!.agentVersion },
            { metrics: runRowToEvalRun(completed[1]!) },
          )
        : null;

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      cases_total: cases.length,
      runs: runs.map((r) => toEvalRunRecordDto(r, agent.name)),
      current,
      delta,
      trend: completed
        .slice()
        .reverse()
        .map(toTrendPoint),
      callout,
    };
  }

  // ===========================================================================
  // Boot-time reconciliation (D19)
  // ===========================================================================

  /** Best-effort — a DB hiccup here must never block boot (server.ts wraps
   *  this in try/catch, the same posture as
   *  `reviewRepo.reapStaleRunningRuns()`). */
  async reconcileStaleRuns(): Promise<number> {
    return this.repo.reconcileStaleRunning(new Date(Date.now() - STALE_RUN_TIMEOUT_MS));
  }
}
