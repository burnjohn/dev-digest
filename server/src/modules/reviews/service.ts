import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  PrIntentDetail,
  RunEventKind,
  RunTrace,
  Severity,
  SmartDiff,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import type { StoredIntent } from './repository/pull.repo.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { classifyIntent, type IntentLogger } from './intent-classifier.js';
import { loadDiff } from './diff-loader.js';
import { buildSmartDiff, type ClassifiableFinding } from './smart-diff/classify.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * REQ-7 retry window (W3 part 3): a stored `model: null` row (a REQ-7
 * fallback classification, honestly persisted) is treated as a cache MISS
 * only once `generatedAt` is older than this window — never on every call.
 * `usePrIntent` POSTs on every mount of the PR page, so without a window a
 * persistent cause (no `OPENROUTER_API_KEY` configured — a supported,
 * key-less boot state) would turn every page view into a fresh
 * classification attempt *plus* a fresh `loadDiff`, bounded only by the
 * route's 10/min rate limit. The window keeps a transient failure
 * self-healing while stopping a permanent one from becoming a retry loop.
 *
 * Consequence accepted deliberately: legacy pre-feature rows also carry
 * `model: null` (migration backfill, `confidence: 'low'`, `sources: []`), so
 * they get re-classified once under this same rule and then settle with a
 * real model — desirable, since they can never otherwise improve.
 *
 * `getIntent` (the GET route, below) does NOT adopt this predicate — REQ-10
 * requires GET to stay purely read-only with no branch that can spend a
 * model call. The asymmetry is intentional: GET reports what is stored,
 * POST decides whether to improve it.
 */
const INTENT_RETRY_WINDOW_MS = 15 * 60 * 1000;

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

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    // `this` satisfies run-executor's `IntentProvider` structurally (it has a
    // `getOrClassifyIntent` method below) — passed so the executor's pre-work
    // step and this service's own routes go through the SAME function
    // (REQ-8/D4). `getOrClassifyIntent` is a prototype method, so it is safe
    // to hand out here even though other instance fields above are still
    // being assigned.
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents, this);
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

  /**
   * Smart Diff (`docs/plans/04-smart-diff.md` §5.1/T6, REQ-1/REQ-7/REQ-8/
   * REQ-11/REQ-12/REQ-20/REQ-23/REQ-25). Computed on READ and persisted
   * nowhere (§5.7) — no table, no cache, no memoization keyed on `prId`. This
   * method does the I/O (the cached `pr_files` read + every review's
   * findings) and the row → `ClassifiableFinding` mapping; ALL classification,
   * ordering, dedup and `default_open` logic lives in the pure
   * `buildSmartDiff` (T2) — nothing here re-implements it. It never resolves
   * `container.llm` or `container.github()`: `pr_files` is read exactly as
   * `pulls/routes.ts`'s `servePersisted` does, so an unavailable upstream
   * degrades to whatever is cached (REQ-20) rather than triggering a refetch.
   */
  async smartDiffForPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.filesForPull(prId);
    const reviews = await this.repo.reviewsForPull(prId);

    // Flatten findings across EVERY review run of the PR, dropping dismissed
    // ones (REQ-7). `buildSmartDiff` does the newest-review-wins dedup itself
    // from `review_created_at` — this loop only maps rows to its input shape.
    const findings: ClassifiableFinding[] = [];
    for (const { review, findings: reviewFindings } of reviews) {
      for (const f of reviewFindings) {
        if (f.dismissedAt != null) continue;
        findings.push({
          id: f.id,
          file: f.file,
          start_line: f.startLine,
          end_line: f.endLine,
          severity: f.severity as Severity,
          title: f.title,
          review_created_at: review.createdAt.toISOString(),
        });
      }
    }

    return buildSmartDiff(
      files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
      findings,
    );
  }

  // ===========================================================================
  // PR intent (plan 03-intent-layer.md T6) — REQ-8/D4: this is the ONLY place
  // classification is triggered. Both entry points — the routes below and the
  // run-executor's pre-work step (which receives `this` as its
  // `IntentProvider`) — call this SAME function, so "at most once per PR
  // lifetime" is a property of the code, not two call sites that happen to
  // agree.
  // ===========================================================================

  /**
   * Cache-first: a stored row (and `force !== true`) returns immediately with
   * ZERO model calls (REQ-8). Tenancy is always checked via `getPull` first —
   * cheap DB reads, never a model call — before the cache is even consulted,
   * so a cache hit still enforces workspace scoping.
   */
  async getOrClassifyIntent(
    workspaceId: string,
    prId: string,
    // `log` is deliberately `IntentLogger` (message-first `info`/`error`),
    // NOT the concrete `RunLogger` class — `IntentProvider.getOrClassifyIntent`
    // (run-executor.ts) still types this param as `RunLogger`, and a real
    // `RunLogger` instance structurally satisfies the narrower `IntentLogger`
    // too, so the run-executor call site is untouched. This widening is what
    // lets `POST /pulls/:id/intent` (routes.ts) — which has no `RunLogger`,
    // only pino's object-first `req.log` — pass in a small adapter instead.
    opts: { force?: boolean; log?: IntentLogger; correlationId?: string } = {},
  ): Promise<PrIntentDetail> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const existing = await this.repo.getIntent(prId);
    // A `model: null` row (a REQ-7 fallback, honestly persisted — W3 part 2)
    // is a cache MISS only once it is older than the retry window; a fresh
    // one, or a row with a real model, is always a hit. See
    // INTENT_RETRY_WINDOW_MS above for why the window exists.
    const isStaleFallback =
      existing !== undefined &&
      existing.model === null &&
      Date.now() - existing.generatedAt.getTime() >= INTENT_RETRY_WINDOW_MS;
    if (existing && opts.force !== true && !isStaleFallback) {
      return this.toPrIntentDetail(prId, existing);
    }

    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);
    const model = await resolveFeatureModel(this.container, workspaceId, 'review_intent');

    // `this.container` structurally satisfies `IntentClassifierDeps`
    // (server/INSIGHTS.md, 2026-08-15 — Container satisfies an explicit Deps
    // interface with no wrapper needed): `llm`/`github` stay lazy resolvers,
    // `git`/`tokenizer` match by shape.
    const { intent: classified, fallback } = await classifyIntent(this.container, {
      repoRef: { owner: repoRow.owner, name: repoRow.name },
      pull: { title: pull.title, body: pull.body },
      diff,
      model,
      log: opts.log,
      correlationId: opts.correlationId,
    });

    // W3 part 2: a REQ-7 fallback never ran the resolved model, so it must
    // not be stamped with one — `model` is nullable in both `db/schema/
    // reviews.ts` and `IntentMeta` for exactly this case.
    const persistedModel = fallback ? null : model.model;
    const generatedAt = new Date();
    await this.repo.upsertIntent(prId, classified, { model: persistedModel, generatedAt });

    return this.toPrIntentDetail(prId, { ...classified, model: persistedModel, generatedAt });
  }

  /** REQ-10 — purely read-only: 404s via `undefined` when no row exists, and
   *  NEVER classifies. No branch here can spend a model call. */
  async getIntent(workspaceId: string, prId: string): Promise<PrIntentDetail | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const existing = await this.repo.getIntent(prId);
    return existing ? this.toPrIntentDetail(prId, existing) : undefined;
  }

  /** `StoredIntent.generatedAt` is a `Date` (T2's integrator note) — the wire's
   *  `PrIntentDetail.generated_at` wants an ISO string; assembling that
   *  conversion is this service's job, not the repository's. */
  private toPrIntentDetail(prId: string, stored: StoredIntent): PrIntentDetail {
    return {
      pr_id: prId,
      intent: stored.intent,
      in_scope: stored.in_scope,
      out_of_scope: stored.out_of_scope,
      confidence: stored.confidence,
      sources: stored.sources,
      model: stored.model,
      generated_at: stored.generatedAt.toISOString(),
    };
  }
}
