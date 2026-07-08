import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import type { SmartDiff } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import * as pullRepo from './repository/pull.repo.js';
import * as reviewRepo from './repository/review.repo.js';
import { classifyFile } from './smart-diff-rules.js';
import { eq, and, desc } from 'drizzle-orm';
import * as t from '../../db/schema.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;
  private logger: Logger;

  constructor(private container: Container, logger?: Logger) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
    this.logger = logger ?? console;
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async getReview(workspaceId: string, reviewId: string): Promise<ReviewDto | undefined> {
    const review = await this.repo.getReview(reviewId);
    if (!review) return undefined;
    const pull = await this.repo.getPull(workspaceId, review.prId);
    if (!pull) return undefined;
    const findings = await this.repo.findingsForReview(reviewId, workspaceId);
    const agentName = review.agentId
      ? (await this.agents.getById(workspaceId, review.agentId))?.name ?? null
      : null;
    return reviewToDto(review, findings, agentName);
  }

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  // ===========================================================================
  // Smart Diff — deterministic file classifier (zero LLM calls)
  // ===========================================================================

  /**
   * Classifies all PR files into core / wiring / boilerplate groups and returns
   * a SmartDiff payload. Zero LLM calls — deterministic, instant, free.
   */
  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff | null> {
    // 1. Verify PR belongs to this workspace before returning any data
    const pr = await pullRepo.getPull(this.container.db, workspaceId, prId);
    if (!pr) return null;

    // 2. Load PR files — return null if the PR has no files at all
    const prFiles = await pullRepo.getPrFiles(this.container.db, prId);
    if (prFiles.length === 0) return null;

    // 2. Find latest review scoped to this workspace
    const [latestReview] = await this.container.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(
        and(
          eq(t.reviews.prId, prId),
          eq(t.repos.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(t.reviews.createdAt))
      .limit(1);

    // 3. Load findings for the latest review (or use empty array if no review yet)
    const findings = latestReview
      ? await reviewRepo.findingsForReview(this.container.db, latestReview.id, workspaceId)
      : [];

    // 4. Index findings by file path
    const findingsByFile = new Map<string, typeof findings>();
    for (const finding of findings) {
      const list = findingsByFile.get(finding.file) ?? [];
      list.push(finding);
      findingsByFile.set(finding.file, list);
    }

    // 5. Classify each PR file and build SmartDiffFile objects
    type SmartDiffFileEntry = {
      role: 'core' | 'wiring' | 'boilerplate';
      file: {
        path: string;
        pseudocode_summary: string | null;
        additions: number;
        deletions: number;
        finding_lines: number[];
        findingsCount: number;
        findings: { id: string; startLine: number; severity: 'critical' | 'warning' | 'suggestion'; category: string; title: string }[];
      };
    };

    const entries: SmartDiffFileEntry[] = prFiles.map((prFile) => {
      const fileFindings = findingsByFile.get(prFile.path) ?? [];
      let role = classifyFile(prFile.path);

      // Normalise severity to lowercase — seed data uses uppercase ('CRITICAL')
      const normFindings = fileFindings.map((f) => ({
        ...f,
        severity: f.severity.toLowerCase() as 'critical' | 'warning' | 'suggestion',
      }));

      // Promote wiring → core when file has critical or warning findings
      if (
        role === 'wiring' &&
        normFindings.some((f) => f.severity === 'critical' || f.severity === 'warning')
      ) {
        role = 'core';
      }

      return {
        role,
        file: {
          path: prFile.path,
          pseudocode_summary: prFile.pseudocodeSummary ?? null,
          additions: prFile.additions,
          deletions: prFile.deletions,
          finding_lines: normFindings.map((f) => f.startLine),
          findingsCount: normFindings.length,
          findings: normFindings.map((f) => ({
            id: f.id,
            startLine: f.startLine,
            severity: f.severity,
            category: f.category,
            title: f.title,
          })),
        },
      };
    });

    // 6. Group files into role buckets, sorted within each group
    const roleOrder: ('core' | 'wiring' | 'boilerplate')[] = ['core', 'wiring', 'boilerplate'];
    const buckets = new Map<'core' | 'wiring' | 'boilerplate', typeof entries[number]['file'][]>([
      ['core', []],
      ['wiring', []],
      ['boilerplate', []],
    ]);
    for (const entry of entries) {
      buckets.get(entry.role)!.push(entry.file);
    }
    for (const files of buckets.values()) {
      files.sort((a, b) => {
        if (b.findingsCount !== a.findingsCount) return b.findingsCount - a.findingsCount;
        return a.path.localeCompare(b.path);
      });
    }

    // 7. Build SmartDiff — include only non-empty groups, ordered core → wiring → boilerplate
    const groups = roleOrder
      .filter((role) => (buckets.get(role)?.length ?? 0) > 0)
      .map((role) => ({ role, files: buckets.get(role)! }));

    this.logger.info({ phase: 'smart-diff', prId }, 'smart-diff: no LLM call — deterministic only');

    return {
      groups,
      split_suggestion: {
        too_big: false,
        total_lines: 0,
        proposed_splits: [],
      },
    };
  }
}
