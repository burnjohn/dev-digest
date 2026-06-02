import type { Container } from '../../platform/container.js';
import type { RunTrace, UnifiedDiff } from '@devdigest/shared';
import type {
  AgentColumn,
  AgentStats,
  Conflict,
  MultiAgentRun,
} from '@devdigest/shared/contracts/observability';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from '../reviews/service.js';
import { AgentsRepository } from '../agents/repository.js';
import { RunsRepository, type AgentRunRow } from './repository.js';
import { computeConflicts, type AgentFindingInput } from './conflicts.js';
import { TrifectaDetector } from './trifecta.js';
import { MEMBER_RUN_GRACE_MS, TREND_WINDOW } from './constants.js';
import { average, averageRounded, sumCostsOrNull } from './helpers.js';

/**
 * A5 — runs service: Multi-Agent Review, Run-Trace passthrough (enriched), and
 * Per-agent Stats. Multi-agent COMPOSES A2's ReviewService (one run per agent),
 * fanned out in parallel through `container.jobs` (the p-queue, §6/§11). Each
 * agent still writes its own `agent_runs` row + ONE `run_traces` document; A5
 * then assembles N columns + computes conflicts. It does NOT mutate A2's review
 * pipeline (composition only).
 */

type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

export class RunsService {
  private repo: RunsRepository;
  private agents: AgentsRepository;
  private reviews: ReviewService;
  private trifecta: TrifectaDetector;

  constructor(private container: Container) {
    this.repo = new RunsRepository(container.db);
    this.agents = new AgentsRepository(container.db);
    this.reviews = new ReviewService(container);
    this.trifecta = new TrifectaDetector(container);
  }

  // ===========================================================================
  // Multi-Agent Review
  // ===========================================================================

  /**
   * Run every enabled agent (or an explicit subset) on a PR in PARALLEL via the
   * JobRunner p-queue, plus the built-in Lethal-Trifecta detector. Persists a
   * `multi_agent_runs` row; returns the assembled columns + conflicts. A partial
   * failure in one agent does not abort the others (§11 resilience).
   */
  async runMultiAgent(
    workspaceId: string,
    prId: string,
    opts: { agentIds?: string[]; includeTrifecta?: boolean } = {},
  ): Promise<MultiAgentRun> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const targets =
      opts.agentIds && opts.agentIds.length > 0
        ? (
            await Promise.all(opts.agentIds.map((id) => this.agents.getById(workspaceId, id)))
          ).filter((a): a is NonNullable<typeof a> => !!a)
        : await this.agents.listEnabled(workspaceId);

    // Record the multi-agent run BEFORE fan-out so members are runs at/after ranAt.
    const mar = await this.repo.createMultiAgentRun(workspaceId, prId);

    // Load the diff once for the trifecta detector (agents load their own).
    const diff = await this.loadDiff(workspaceId, prId, pull.repoId);

    // Fan-out: one ReviewService run per agent, enqueued on the shared p-queue.
    // Each enqueued job runs A2's reviewer for a single agent → its own runId,
    // agent_runs row, run_traces doc, and SSE stream (per-agent observability).
    const jobs = targets.map((agent) =>
      this.container.jobs
        .enqueue(workspaceId, 'multi_agent_review', { workspaceId, prId, agentId: agent.id })
        .then((j) => j.done)
        .catch(() => undefined),
    );

    // The built-in detector runs alongside the LLM agents.
    const trifectaP = (opts.includeTrifecta ?? true)
      ? this.trifecta
          .run(workspaceId, { prId, prNumber: pull.number, diff })
          .catch(() => undefined)
      : Promise.resolve(undefined);

    await Promise.all([...jobs, trifectaP]);

    return this.assembleMultiAgentRun(workspaceId, mar.id);
  }

  /** Register the job handler used by the fan-out (called once at module load). */
  registerJobHandler(): void {
    if (this.handlerRegistered) return;
    this.handlerRegistered = true;
    this.container.jobs.register('multi_agent_review', async (payload) => {
      const p = payload as { workspaceId: string; prId: string; agentId: string };
      const agent = await this.agents.getById(p.workspaceId, p.agentId);
      if (!agent) return;
      // Reuse A2's reviewer for exactly one agent (creates its own run + trace).
      await this.reviews.runReview(p.workspaceId, p.prId, [agent]);
    });
  }
  private handlerRegistered = false;

  /** Rebuild a MultiAgentRun (columns + conflicts) from persisted rows. */
  async assembleMultiAgentRun(workspaceId: string, marId: string): Promise<MultiAgentRun> {
    const mar = await this.repo.getMultiAgentRun(workspaceId, marId);
    if (!mar) throw new NotFoundError('Multi-agent run not found');
    return this.buildFromRun(workspaceId, mar);
  }

  async latestForPull(workspaceId: string, prId: string): Promise<MultiAgentRun | undefined> {
    const mar = await this.repo.latestMultiAgentRunForPull(workspaceId, prId);
    if (!mar) return undefined;
    return this.buildFromRun(workspaceId, mar);
  }

  private async buildFromRun(
    workspaceId: string,
    mar: { id: string; prId: string; ranAt: Date },
  ): Promise<MultiAgentRun> {
    const pull = await this.repo.getPull(workspaceId, mar.prId);
    // Member runs = agent_runs for this PR at/after the multi-agent run's ranAt
    // (a small grace window absorbs clock skew between the INSERT and member rows).
    const since = new Date(mar.ranAt.getTime() - MEMBER_RUN_GRACE_MS);
    const runs = await this.repo.agentRunsForPullSince(mar.prId, since);

    // Latest review per agent (and the agent-less trifecta review) for findings.
    const reviewRows = await this.repo.reviewsForPull(mar.prId);
    const reviewByAgent = new Map<string | null, (typeof reviewRows)[number]>();
    for (const r of reviewRows) {
      const key = r.review.agentId;
      if (!reviewByAgent.has(key)) reviewByAgent.set(key, r); // newest-first → first wins
    }

    const columns: AgentColumn[] = [];
    const conflictInputs: AgentFindingInput[] = [];

    for (const run of runs) {
      const agent = run.agentId ? await this.repo.getAgent(workspaceId, run.agentId) : undefined;
      const agentName = agent?.name ?? (run.model === 'lethal-trifecta' ? 'Lethal-Trifecta' : 'Agent');
      const review = reviewByAgent.get(run.agentId);
      const findings = review?.findings ?? [];

      columns.push({
        run_id: run.id,
        agent_id: run.agentId ?? `builtin:${run.id}`,
        agent_name: agentName,
        provider: run.provider,
        model: run.model,
        status: (run.status as AgentColumn['status']) ?? 'done',
        verdict: review?.review.verdict ?? null,
        score: review?.review.score ?? null,
        summary: review?.review.summary ?? null,
        duration_ms: run.durationMs ?? null,
        cost_usd: run.costUsd ?? null,
        findings: findings.map((f) => ({
          id: f.id,
          severity: f.severity as Severity,
          category: f.category,
          title: f.title,
          file: f.file,
          start_line: f.startLine,
          kind: f.kind ?? 'finding',
        })),
      });

      conflictInputs.push({
        agentId: run.agentId ?? `builtin:${run.id}`,
        agentName,
        reviewed: !!review,
        findings: findings.map((f) => ({
          file: f.file,
          start_line: f.startLine,
          title: f.title,
          severity: f.severity as Severity,
          rationale: f.rationale,
        })),
      });
    }

    const conflicts: Conflict[] = computeConflicts(conflictInputs);
    const totalDuration = runs.reduce((n, r) => n + (r.durationMs ?? 0), 0);
    const totalCost = sumCostsOrNull(runs.map((r) => r.costUsd));

    return {
      id: mar.id,
      pr_id: mar.prId,
      pr_number: pull?.number ?? null,
      ran_at: mar.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totalDuration,
      total_cost_usd: totalCost,
      columns,
      conflicts,
    };
  }

  // ===========================================================================
  // Run trace (enriched single document; same endpoint A2 registered)
  // ===========================================================================

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Per-agent Stats (GET /agents/:id/stats)
  // ===========================================================================

  async agentStats(workspaceId: string, agentId: string): Promise<AgentStats> {
    const agent = await this.repo.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const runs = await this.repo.agentRunsForAgent(workspaceId, agentId);
    const findings = await this.repo.findingsForAgent(workspaceId, agentId);

    const accepted = findings.filter((f) => f.acceptedAt != null).length;
    const dismissed = findings.filter((f) => f.dismissedAt != null).length;
    const pending = findings.length - accepted - dismissed;
    const acted = accepted + dismissed;

    const bySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
    for (const f of findings) {
      if (f.severity === 'CRITICAL' || f.severity === 'WARNING' || f.severity === 'SUGGESTION') {
        bySeverity[f.severity as Severity] += 1;
      }
    }

    const doneRuns = runs.filter((r) => r.status === 'done');
    const costs = doneRuns.map((r) => r.costUsd).filter((c): c is number => c != null);
    const totalCost = costs.length > 0 ? costs.reduce((n, c) => n + c, 0) : null;
    const latencies = doneRuns.map((r) => r.durationMs).filter((d): d is number => d != null);
    const avgLatency = averageRounded(latencies);

    const findingsCounts = doneRuns
      .map((r) => r.findingsCount)
      .filter((c): c is number => c != null);
    const avgFindings = average(findingsCounts);

    return {
      agent_id: agentId,
      agent_name: agent.name,
      runs: runs.length,
      findings_total: findings.length,
      accepted,
      dismissed,
      pending,
      accept_rate: acted > 0 ? accepted / acted : null,
      dismiss_rate: acted > 0 ? dismissed / acted : null,
      avg_findings_per_run: avgFindings,
      total_cost_usd: totalCost,
      avg_cost_usd: costs.length > 0 ? (totalCost ?? 0) / costs.length : null,
      avg_latency_ms: avgLatency,
      findings_by_severity: bySeverity,
      trend: this.buildTrend(runs),
    };
  }

  /** A small accept-rate-friendly trend: findings per run over the last 12 runs. */
  private buildTrend(runs: AgentRunRow[]): { label: string; value: number }[] {
    return runs
      .slice(-TREND_WINDOW)
      .map((r, i) => ({ label: `run ${i + 1}`, value: r.findingsCount ?? 0 }));
  }

  // ===========================================================================
  // Diff loader (mirrors A2's behaviour; git first, pr_files fallback)
  // ===========================================================================

  private async loadDiff(
    workspaceId: string,
    prId: string,
    repoId: string,
  ): Promise<UnifiedDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    const [repo] = await this.container.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    if (pull && repo) {
      try {
        const diff = await this.container.git.diff(
          { owner: repo.owner, name: repo.name },
          pull.base,
          pull.headSha,
        );
        if (diff.files.length > 0) return diff;
      } catch {
        /* fall through */
      }
    }
    const files = await this.container.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    const parts: string[] = [];
    for (const f of files) {
      if (!f.patch) continue;
      parts.push(`diff --git a/${f.path} b/${f.path}`);
      parts.push(`--- a/${f.path}`);
      parts.push(`+++ b/${f.path}`);
      parts.push(f.patch);
    }
    return parseUnifiedDiff(parts.join('\n'));
  }
}
