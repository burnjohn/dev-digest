import type { Container } from '../../platform/container.js';
import type { Finding, Provider, Review, EvalRun } from '@devdigest/shared';
import { Review as ReviewSchema } from '@devdigest/shared';
import type {
  EvalCaseInput,
  EvalDashboard,
  EvalRunRecord,
  EvalRunResult,
  EvalTrendPoint,
} from '@devdigest/shared/contracts/eval-ci';
import { assemblePrompt } from '../../platform/prompt.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { groundFindings } from '../../platform/grounding.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AgentsRepository } from '../agents/repository.js';
import { EvalRepository, type EvalCaseRow, type EvalRunRow } from './repository.js';
import { RECENT_RUNS_LIMIT, REGRESSION_THRESHOLD } from './constants.js';
import { expectedFindings, normPath, round } from './helpers.js';

/**
 * A4 — Eval pipeline (§7 L06). For a case whose owner is an *agent*, we run the
 * agent on the case's `input_diff` (synthetic PR), ground the findings against
 * the diff, then compare actual vs `expected_output` to compute:
 *   - recall            = matched expected / expected_total
 *   - precision         = matched expected / actual_total
 *   - citation_accuracy = grounded findings / actual_total
 * A case passes when recall === 1 and precision === 1 (every expected finding
 * found, no extras). Metrics + actual output are persisted to `eval_runs`.
 *
 * For skill-owned cases (no runnable agent) we degrade gracefully: the case can
 * still be stored/edited; running it requires resolving an agent (400 if none).
 */
export class EvalService {
  private repo: EvalRepository;
  private agents: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.agents = new AgentsRepository(container.db);
  }

  // ---- CRUD ---------------------------------------------------------------

  async listCases(
    workspaceId: string,
    filter?: { ownerKind?: 'agent' | 'skill'; ownerId?: string },
  ): Promise<(EvalCaseRow & { last_run?: EvalRunRecord })[]> {
    const cases = await this.repo.listCases(workspaceId, filter);
    const runs = await this.repo.runsForCases(cases.map((c) => c.id));
    const byCase = new Map<string, EvalRunRow>();
    for (const r of runs) if (!byCase.has(r.caseId)) byCase.set(r.caseId, r); // newest first
    return cases.map((c) => {
      const last = byCase.get(c.id);
      return { ...c, last_run: last ? this.runToRecord(last, c.name) : undefined };
    });
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, id);
    if (!row) throw new NotFoundError('Eval case not found');
    return row;
  }

  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCaseRow> {
    return this.repo.insertCase({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff ?? '',
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? null,
      notes: input.notes ?? null,
    });
  }

  async updateCase(
    workspaceId: string,
    id: string,
    input: Partial<EvalCaseInput>,
  ): Promise<EvalCaseRow> {
    await this.getCase(workspaceId, id);
    const row = await this.repo.updateCase(workspaceId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.input_diff !== undefined ? { inputDiff: input.input_diff } : {}),
      ...(input.input_files !== undefined ? { inputFiles: input.input_files } : {}),
      ...(input.input_meta !== undefined ? { inputMeta: input.input_meta } : {}),
      ...(input.expected_output !== undefined ? { expectedOutput: input.expected_output } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.owner_kind !== undefined ? { ownerKind: input.owner_kind } : {}),
      ...(input.owner_id !== undefined ? { ownerId: input.owner_id } : {}),
    });
    return row!;
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    await this.getCase(workspaceId, id);
    await this.repo.deleteCase(workspaceId, id);
  }

  // ---- Run a case ---------------------------------------------------------

  async runCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const ec = await this.getCase(workspaceId, caseId);
    const { review, costUsd, durationMs } = await this.runOwnerOnDiff(workspaceId, ec);

    const diff = parseUnifiedDiff(ec.inputDiff ?? '');
    const ground = groundFindings(review.findings, diff);
    const actual = ground.kept;

    const expected = expectedFindings(ec.expectedOutput);
    const metrics = this.score(expected, actual, review.findings.length);

    const pass = metrics.recall === 1 && metrics.precision === 1;

    const run = await this.repo.insertRun({
      caseId: ec.id,
      actualOutput: { verdict: review.verdict, score: review.score, findings: actual },
      pass,
      recall: metrics.recall,
      precision: metrics.precision,
      citationAccuracy: metrics.citation_accuracy,
      durationMs,
      costUsd,
    });

    const result: EvalRun = {
      recall: metrics.recall,
      precision: metrics.precision,
      citation_accuracy: metrics.citation_accuracy,
      traces_passed: pass ? 1 : 0,
      traces_total: 1,
      duration_ms: durationMs,
      cost_usd: costUsd,
      per_trace: [
        {
          name: ec.name,
          pass,
          expected,
          actual,
        },
      ],
    };

    return { run_id: run.id, case_id: ec.id, result };
  }

  /** Run every case owned by an agent (the agent-editor "Run all"). */
  async runAllForAgent(workspaceId: string, agentId: string): Promise<EvalRun> {
    const cases = await this.repo.listCases(workspaceId, { ownerKind: 'agent', ownerId: agentId });
    if (cases.length === 0) {
      return {
        recall: 0,
        precision: 0,
        citation_accuracy: 0,
        traces_passed: 0,
        traces_total: 0,
        duration_ms: 0,
        cost_usd: 0,
        per_trace: [],
      };
    }
    const results = await Promise.all(cases.map((c) => this.runCase(workspaceId, c.id)));
    return this.aggregate(results.map((r) => r.result));
  }

  /** Merge per-case EvalRuns into one (means over cases; sums for traces/cost). */
  private aggregate(runs: EvalRun[]): EvalRun {
    const n = runs.length || 1;
    const mean = (sel: (r: EvalRun) => number) => runs.reduce((s, r) => s + sel(r), 0) / n;
    const cost = runs.reduce<number | null>(
      (s, r) => (s == null || r.cost_usd == null ? null : s + r.cost_usd),
      0,
    );
    return {
      recall: mean((r) => r.recall),
      precision: mean((r) => r.precision),
      citation_accuracy: mean((r) => r.citation_accuracy),
      traces_passed: runs.reduce((s, r) => s + r.traces_passed, 0),
      traces_total: runs.reduce((s, r) => s + r.traces_total, 0),
      duration_ms: runs.reduce((s, r) => s + r.duration_ms, 0),
      cost_usd: cost,
      per_trace: runs.flatMap((r) => r.per_trace),
    };
  }

  // ---- Dashboard ----------------------------------------------------------

  async dashboard(
    workspaceId: string,
    filter?: { ownerKind?: 'agent' | 'skill'; ownerId?: string },
  ): Promise<EvalDashboard> {
    const cases = await this.repo.listCases(workspaceId, filter);
    const runs = await this.repo.runsForCases(cases.map((c) => c.id));
    const caseName = new Map(cases.map((c) => [c.id, c.name]));

    // chronological (oldest → newest) for the trend line
    const chrono = [...runs].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
    const trend: EvalTrendPoint[] = chrono.map((r) => ({
      ran_at: r.ranAt.toISOString(),
      recall: r.recall ?? 0,
      precision: r.precision ?? 0,
      citation_accuracy: r.citationAccuracy ?? 0,
      pass_rate: r.pass ? 1 : 0,
      cost_usd: r.costUsd ?? null,
    }));

    // "current" = mean of the most-recent run per case
    const latestByCase = new Map<string, EvalRunRow>();
    for (const r of runs) if (!latestByCase.has(r.caseId)) latestByCase.set(r.caseId, r); // newest first
    const latest = [...latestByCase.values()];
    const meanOf = (sel: (r: EvalRunRow) => number | null) =>
      latest.length ? latest.reduce((s, r) => s + (sel(r) ?? 0), 0) / latest.length : 0;

    const current = {
      recall: meanOf((r) => r.recall),
      precision: meanOf((r) => r.precision),
      citation_accuracy: meanOf((r) => r.citationAccuracy),
      traces_passed: latest.filter((r) => r.pass).length,
      traces_total: latest.length,
      cost_usd: latest.reduce<number | null>(
        (s, r) => (s == null || r.costUsd == null ? null : s + r.costUsd),
        0,
      ),
    };

    // delta = current vs the previous run's metrics (last two trend points)
    const prev = trend.length >= 2 ? trend[trend.length - 2]! : null;
    const last = trend.length >= 1 ? trend[trend.length - 1]! : null;
    const delta = {
      recall: last && prev ? round(last.recall - prev.recall) : 0,
      precision: last && prev ? round(last.precision - prev.precision) : 0,
      citation_accuracy: last && prev ? round(last.citation_accuracy - prev.citation_accuracy) : 0,
    };

    const alert =
      delta.precision < REGRESSION_THRESHOLD
        ? `Precision dropped ${Math.round(Math.abs(delta.precision) * 100)}pts on the latest run — review for new false positives.`
        : delta.recall < REGRESSION_THRESHOLD
          ? `Recall dropped ${Math.round(Math.abs(delta.recall) * 100)}pts on the latest run — a regression may be missing findings.`
          : null;

    return {
      owner_kind: filter?.ownerKind ?? null,
      owner_id: filter?.ownerId ?? null,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: runs.slice(0, RECENT_RUNS_LIMIT).map((r) => this.runToRecord(r, caseName.get(r.caseId))),
      alert,
    };
  }

  // ---- Helpers ------------------------------------------------------------

  /** Resolve the owning agent + run it on the synthetic diff → a Review. */
  private async runOwnerOnDiff(
    workspaceId: string,
    ec: EvalCaseRow,
  ): Promise<{ review: Review; costUsd: number | null; durationMs: number }> {
    const agent = await this.resolveAgent(workspaceId, ec);
    const llm = await this.container.llm(agent.provider as Provider);
    const skillBodies = await this.collectSkills(agent.id);
    const meta = (ec.inputMeta ?? {}) as { title?: string; body?: string };

    const { messages } = assemblePrompt({
      system: agent.systemPrompt,
      skills: skillBodies,
      diff: ec.inputDiff ?? '',
      task: `Eval case "${ec.name}". Review the diff${
        meta.title ? ` for PR "${meta.title}"` : ''
      } and return findings, each citing an exact file and line range present in the diff.`,
    });

    const start = Date.now();
    const res = await llm.completeStructured<Review>({
      model: agent.model,
      schema: ReviewSchema,
      schemaName: 'Review',
      messages,
      maxRetries: 2,
    });
    return { review: res.data, costUsd: res.costUsd, durationMs: Date.now() - start };
  }

  /**
   * Resolve a runnable agent for the case. Agent-owned → that agent. Skill-owned
   * → an enabled agent that links the skill (so the rubric is actually applied),
   * else any enabled agent. 400 if none exist.
   */
  private async resolveAgent(workspaceId: string, ec: EvalCaseRow) {
    if (ec.ownerKind === 'agent') {
      const agent = await this.agents.getById(workspaceId, ec.ownerId);
      if (!agent) throw new NotFoundError('Owner agent not found');
      return agent;
    }
    const enabled = await this.agents.listEnabled(workspaceId);
    for (const a of enabled) {
      const ids = await this.agents.skillIdsForAgent(a.id);
      if (ids.includes(ec.ownerId)) return a;
    }
    if (enabled[0]) return enabled[0];
    throw new AppError('no_runnable_agent', 'No enabled agent available to run this eval case', 400);
  }

  private async collectSkills(agentId: string): Promise<string[]> {
    const links = await this.agents.linkedSkills(agentId);
    return links.filter((l) => l.skill.enabled).map((l) => `### ${l.skill.name}\n${l.skill.body}`);
  }

  /**
   * Compute recall/precision/citation. An expected finding is "matched" when an
   * actual finding hits the same file and an overlapping line (or same title,
   * case-insensitive). Citation = fraction of *all* model findings that survived
   * grounding (groundedCount / rawCount).
   */
  private score(
    expected: Partial<Finding>[],
    actual: Finding[],
    rawCount: number,
  ): { recall: number; precision: number; citation_accuracy: number } {
    if (expected.length === 0 && actual.length === 0) {
      return { recall: 1, precision: 1, citation_accuracy: 1 };
    }
    const usedActual = new Set<number>();
    let matched = 0;
    for (const e of expected) {
      const idx = actual.findIndex((a, i) => !usedActual.has(i) && this.findingMatches(e, a));
      if (idx >= 0) {
        usedActual.add(idx);
        matched += 1;
      }
    }
    const recall = expected.length ? matched / expected.length : actual.length === 0 ? 1 : 0;
    const precision = actual.length ? matched / actual.length : expected.length === 0 ? 1 : 0;
    const citation = rawCount ? actual.length / rawCount : 1;
    return {
      recall: round(recall),
      precision: round(precision),
      citation_accuracy: round(citation),
    };
  }

  private findingMatches(e: Partial<Finding>, a: Finding): boolean {
    const sameFile = e.file ? normPath(e.file) === normPath(a.file) : true;
    if (!sameFile) return false;
    // line overlap when an expected line is provided
    if (typeof e.start_line === 'number') {
      const eStart = e.start_line;
      const eEnd = typeof e.end_line === 'number' ? e.end_line : e.start_line;
      const overlap = a.start_line <= eEnd && a.end_line >= eStart;
      if (overlap) return true;
    }
    // title match (case-insensitive substring either way)
    if (e.title) {
      const et = e.title.toLowerCase();
      const at = a.title.toLowerCase();
      if (at.includes(et) || et.includes(at)) return true;
    }
    // category + severity match as a weaker signal when no line/title given
    if (!e.start_line && !e.title) {
      return (
        (!e.severity || e.severity === a.severity) && (!e.category || e.category === a.category)
      );
    }
    return false;
  }

  private runToRecord(r: EvalRunRow, caseName?: string): EvalRunRecord {
    return {
      id: r.id,
      case_id: r.caseId,
      case_name: caseName ?? null,
      ran_at: r.ranAt.toISOString(),
      actual_output: r.actualOutput,
      pass: r.pass,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citationAccuracy,
      duration_ms: r.durationMs,
      cost_usd: r.costUsd,
    };
  }
}
