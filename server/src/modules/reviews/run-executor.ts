import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, RunTraceContextDoc, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers, classifyIntent } from '@devdigest/reviewer-core';
import type { Intent } from '@devdigest/shared';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { composePrBrief } from './brief-composer.js';
import { routeModel } from '../../platform/model-router.js';
import { classifyFile } from './smart-diff-rules.js';
import { resolveConfinedPath } from '../context-docs/helpers.js';

/**
 * Derived from the container's agentsRepo interface without importing
 * `agents/repository.js` directly (module isolation rule — mirrors
 * `blast/service.ts`'s `BlastResult` derivation pattern).
 */
type LinkedSkillRow = Awaited<ReturnType<Container['agentsRepo']['linkedSkills']>>[number];

/**
 * Conservative safe token budget for the DIFF portion of the prompt.
 * Real overhead per run: ~44K tokens (system prompt + repo map + 4-5 injected skills).
 * Budget = context_limit - 44K overhead - 5K safety buffer.
 */
function diffBudgetForModel(model: string): number {
  if (/gpt-4\.1|o3/.test(model))          return 900_000;           // 1M+ context
  if (/gemini/.test(model))                return 900_000;           // 1M context
  if (/gpt-4o/.test(model))               return  75_000;           // 128K ctx − 53K overhead
  if (/claude.*(haiku|sonnet|opus)/.test(model)) return 150_000;    // 200K ctx − 50K overhead
  if (/deepseek/.test(model))             return  15_000;            // 64K ctx − 49K overhead
  return 60_000;                                                      // safe default
}

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Build a compact files summary for the intent classifier.
 * Includes ONLY file paths, +/- counts, and @@ hunk position headers.
 * Deliberately excludes code body lines (+/-) to keep the prompt small.
 */
function buildFilesSummary(diff: UnifiedDiff): string {
  return diff.files
    .map((f) => {
      const hunkHeaders = f.hunks
        .map((h) => `  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
        .join('\n');
      return `${f.path} (+${f.additions}/-${f.deletions})${hunkHeaders ? '\n' + hunkHeaders : ''}`;
    })
    .join('\n\n');
}

/** Linear-scan, keep-order dedupe (mirrors `blast/service.ts`'s `dedupeStrings`). */
function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!out.some((existing) => existing === v)) out.push(v);
  }
  return out;
}

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // ---- Intent pre-pass (shared across all agents in this batch) ---------
    // Classify the PR intent once. Cached in pr_intent — subsequent runs reuse
    // the stored result. Pass the intent to each agent's review prompt.
    let intent: Intent | undefined;
    try {
      intent = await this.repo.getIntent(pull.id);
      if (!intent) {
        const firstProvider = (jobs[0]?.agent.provider ?? 'anthropic') as Parameters<typeof routeModel>[1];
        const intentModel = routeModel('intent', firstProvider);
        const intentLlm = await this.container.llm(firstProvider);
        const filesSummary = buildFilesSummary(diff);
        const intentStart = Date.now();
        const result = await classifyIntent({
          title: pull.title,
          body: pull.body ?? '',
          filesSummary,
          llm: intentLlm,
          model: intentModel,
          sessionId: `intent:${pull.id}`,
        });
        const { tokensIn, tokensOut, costUsd, ...intentData } = result;
        intent = intentData;
        await this.repo.upsertIntent(pull.id, intent);
        logger?.info(
          {
            phase: 'intent',
            prId: pull.id,
            model: intentModel,
            tokensIn,
            tokensOut,
            costUsd,
            durationMs: Date.now() - intentStart,
          },
          'intent: classification complete',
        );
        runLog.info(`intent: classified using ${intentModel} — ${tokensIn} in / ${tokensOut} out`);
      } else {
        runLog.info('intent: using cached classification');
        logger?.info({ phase: 'intent', prId: pull.id }, 'intent: cache hit');
      }
    } catch (err) {
      runLog.info(`intent: classification failed — ${(err as Error).message} — proceeding without intent`);
      logger?.warn({ phase: 'intent', prId: pull.id, err: (err as Error).message }, 'intent: classification failed (non-fatal)');
      // Intent is optional — never fail the whole review batch because of it
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, agent, runId, runLog, intent);
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    intent?: Intent,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    // Captured after reviewPullRequest returns; stay at defaults when the engine
    // throws before returning (cancelled/failed mid-LLM — no partial data yet).
    let partialCostUsd: number | null = null;
    // Explicit flag: true once reviewPullRequest returns, so the catch path can
    // distinguish "LLM never returned" (skip cost write) from "LLM returned with
    // unknown pricing" (write null). Avoids the fragile `null ?? undefined` idiom.
    let partialCostKnown = false;
    let partialTokensIn = 0;
    let partialTokensOut = 0;
    let partialGrounding = '0/0 passed';
    let partialFindingsCount = 0;
    // Set to true only after both completion writes succeed, so a failed trace
    // write still marks the run failed instead of leaving status='done' with no
    // trace document.
    let runCompleted = false;

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // ---- Skills injection ------------------------------------------------
      // Load enabled skills attached to this agent and inject their bodies into
      // the prompt. Order is determined by agent_skills.order (user-controlled).
      const linkedSkills = await this.agents.linkedSkills(agent.id);
      const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);
      if (skillBodies.length) {
        runLog.info(`skills: ${skillBodies.length} skill(s) injected`);
      }

      // ---- Project context documents injection -------------------------------
      // Agent-direct attachments + attachments of the agent's already-fetched
      // linked+enabled skills (reuses `linkedSkills` above — no re-fetch),
      // deduped by path, read fresh from the PR's repo clone, confined, and
      // tokenized. Never throws — unreadable/out-of-bounds paths are recorded
      // as `skipped` trace entries and the run proceeds normally.
      const contextDocsResult = await this.buildContextDocs(
        workspaceId,
        pull.repoId,
        repo,
        agent.id,
        linkedSkills,
        runLog,
      );

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      //
      // Trim the diff to fit within the model's context window BEFORE sending.
      // Core files are kept first; boilerplate dropped last when over budget.
      const budgetedDiff = this.budgetDiff(diff, agent.model, runLog);
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff: budgetedDiff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Enabled skills attached to this agent, in user-defined order.
        ...(skillBodies.length ? { skills: skillBodies } : {}),
        // Attached Project Context documents (agent-direct ∪ via linked skills,
        // deduped), raw text — assemblePrompt wraps each with wrapUntrusted.
        ...(contextDocsResult.specs.length ? { specs: contextDocsResult.specs } : {}),
        // Intent pre-pass result — shared across agents in this batch, cached in
        // pr_intent. Undefined when classification failed (non-fatal).
        ...(intent ? { intent } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      partialCostUsd = outcome.costUsd ?? null;
      partialCostKnown = true;
      partialTokensIn = outcome.tokensIn;
      partialTokensOut = outcome.tokensOut;
      partialGrounding = outcome.grounding;
      partialFindingsCount = outcome.review.findings.length;
      const { tokensIn, tokensOut, grounding } = outcome;

      const keptFindings = outcome.review.findings;

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, keptFindings);
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: agent_runs + ONE run_traces document --------------
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
        costUsd: outcome.costUsd,
      });
      runCompleted = true;

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        context_documents: contextDocsResult.trace,
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          findings: findingRows.length,
          grounding,
          cost_usd: outcome.costUsd ?? null,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        // Repurposed from always-`[]`: paths of the context documents that were
        // actually injected this run (skipped entries are excluded).
        specs_read: contextDocsResult.trace.filter((d) => d.status === 'injected').map((d) => d.path),
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      // Set only after BOTH completeAgentRun + saveRunTrace succeed — the catch
      // block uses this flag to skip re-writing status='failed' when the success
      // path already finished cleanly. Setting it earlier would leave the run
      // marked done with no trace if saveRunTrace threw.
      runCompleted = true;
      this.container.runBus.complete(runId);

      // L04: compose the live PR Brief (intent + blast + deterministic risks +
      // prior-PR history) — zero LLM calls. Non-fatal by design: a brief
      // composition failure must never affect an already-completed run.
      try {
        const [intent, blastResponse] = await Promise.all([
          this.repo.getIntent(pull.id),
          this.container.blast.getBlast(pull.workspaceId, pull.id),
        ]);
        await this.repo.upsertBrief(
          pull.id,
          composePrBrief({ intent, blastResponse, findings: keptFindings }),
        );
        runLog.info('PR brief composed and stored (0 LLM calls)');
      } catch (briefErr) {
        runLog.info(`PR brief composition skipped: ${(briefErr as Error).message}`);
      }

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      // Skip only if the success path already wrote status='done' and persisted
      // the trace. If either write failed, runCompleted stays false and this
      // catch path records the failure state instead.
      if (!runCompleted) {
        await this.repo
          .completeAgentRun(runId, {
            status,
            durationMs: Date.now() - start,
            tokensIn: partialTokensIn,
            tokensOut: partialTokensOut,
            findingsCount: partialFindingsCount,
            grounding: partialGrounding,
            error: msg,
            // When the LLM never returned, skip the column write (don't clear a
            // previously stored cost). When it returned with unknown pricing,
            // write null explicitly to record "cost is known to be absent".
            costUsd: partialCostKnown ? partialCostUsd : undefined,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, partialGrounding, Date.now() - start))
          .catch(() => undefined);
      }
      // Always release the SSE stream — even when runCompleted=true and the
      // if block above was skipped.
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * Resolve, dedupe, read, and tokenize this agent's attached Project Context
   * documents (agent-direct ∪ via the agent's linked+enabled skills), fresh
   * against the PR's repo clone at run time.
   *
   * - Merge order: agent-direct attachments first (in their order), then
   *   skill-derived attachments (in skill order, then per-skill attachment
   *   order) — deduped by path, first occurrence wins (AC-14).
   * - Each deduped path is re-validated with `resolveConfinedPath` (AC-13) —
   *   a stale/crafted/relocated path is never read; it is recorded as
   *   `skipped` with a `skip_reason` and the run proceeds normally.
   * - A confined path that still fails to read (deleted since attach, AC-12)
   *   is likewise recorded as `skipped`, never thrown.
   * - Overlay content, when present for a path, is preferred over the clone
   *   read (AC-25) — the CONFINEMENT check still applies to the path itself;
   *   only the content SOURCE changes. On a no-clone repo (AC-36) an
   *   overlay-attached path injects from the overlay; a path with no overlay
   *   takes the existing AC-12 "file not found in clone" skip.
   * - `wrapUntrusted` wrapping happens inside reviewer-core's `assemblePrompt`
   *   — this method appends RAW text only (overlay body or clone content
   *   identically — AC-30).
   *
   * Never throws — any repo/config lookup failure degrades to "no context
   * documents this run" (mirrors the other best-effort enrichment builders in
   * this class, e.g. `buildCallersDigest`/`buildRepoMapDigest`).
   */
  private async buildContextDocs(
    workspaceId: string,
    repoId: string,
    repo: typeof schema.repos.$inferSelect,
    agentId: string,
    linkedSkills: LinkedSkillRow[],
    runLog: RunLogger,
  ): Promise<{ specs: string[]; trace: RunTraceContextDoc[] }> {
    try {
      // ---- Resolve attachments: agent-direct ∪ via linked+enabled skills ----
      const agentLinks = await this.container.contextDocs.agentAttachments(agentId);
      const orderedPaths: string[] = agentLinks.map((l) => l.path);

      const enabledSkills = linkedSkills.filter((l) => l.skill.enabled);
      for (const { skill } of enabledSkills) {
        const skillLinks = await this.container.contextDocs.skillAttachments(skill.id);
        for (const link of skillLinks) orderedPaths.push(link.path);
      }

      const dedupedPaths = dedupeStrings(orderedPaths);
      if (dedupedPaths.length === 0) return { specs: [], trace: [] };

      // ---- Resolve repo context folders + clone root -------------------------
      // `ContextDocsService.getContextFolders` throws NotFoundError for a
      // missing/cross-workspace repo (unlike the repository-level method it
      // wraps, which returns `undefined`); `repo` here is already a loaded,
      // validated row, so this should never actually happen — but degrade to
      // "no configured folders" (matching the prior `folders ?? []`
      // semantics) rather than let the outer catch wipe out the per-doc
      // `skipped` trace entries below.
      let folders: string[] | undefined;
      try {
        folders = await this.container.contextDocs.getContextFolders(workspaceId, repoId);
      } catch {
        folders = undefined;
      }
      const repoRef = { owner: repo.owner, name: repo.name };
      const cloneRoot = this.container.git.clonePathFor(repoRef);
      const effectiveFolders = folders ?? [];

      const specs: string[] = [];
      const trace: RunTraceContextDoc[] = [];

      for (const docPath of dedupedPaths) {
        const confined = resolveConfinedPath(cloneRoot, effectiveFolders, docPath);
        if (!confined) {
          trace.push({
            path: docPath,
            token_size: 0,
            status: 'skipped',
            skip_reason: 'outside clone root or configured folders',
          });
          continue;
        }

        const relPath = docPath.replace(/\\/g, '/');

        // Overlay content, when present for this path, is preferred over the
        // clone read (AC-25). The CONFINEMENT check above still applies to the
        // path itself; only the content SOURCE changes. For a no-clone repo
        // (AC-36) the overlay branch is what supplies content — the clone read
        // below would always fail there, which is the existing AC-12 skip path.
        const overlay = await this.container.contextDocs.getOverlayForInjection(repoId, docPath);

        let content: string;
        if (overlay) {
          content = overlay.body;
        } else {
          try {
            content = await this.container.git.readFile(repoRef, relPath);
          } catch {
            trace.push({
              path: docPath,
              token_size: 0,
              status: 'skipped',
              skip_reason: 'file not found in clone',
            });
            continue;
          }
        }

        const tokenSize = this.container.tokenizer.count(content);
        trace.push({ path: docPath, token_size: tokenSize, status: 'injected', skip_reason: null });
        specs.push(content);
      }

      const injectedCount = trace.filter((d) => d.status === 'injected').length;
      const skippedCount = trace.length - injectedCount;
      const injectedTokens = trace
        .filter((d) => d.status === 'injected')
        .reduce((sum, d) => sum + d.token_size, 0);
      if (trace.length > 0) {
        runLog.info(
          `context docs: ${injectedCount} injected (${injectedTokens} tokens), ${skippedCount} skipped`,
        );
      }

      return { specs, trace };
    } catch (err) {
      // Never let context-doc resolution break a run — degrade to "none".
      runLog.info(`context docs: resolution failed — ${(err as Error).message}`);
      return { specs: [], trace: [] };
    }
  }

  /**
   * Trim the diff to fit within the per-model safe token budget before sending
   * to the LLM. Returns the original diff unchanged when it already fits.
   *
   * Priority: core → wiring → boilerplate (greedy-pack — smaller wiring/boilerplate
   * files may still fill gaps even when a large core file doesn't fit).
   */
  private budgetDiff(diff: UnifiedDiff, model: string, runLog: RunLogger): UnifiedDiff {
    const budget = diffBudgetForModel(model);
    const totalTokens = this.container.tokenizer.count(diff.raw);
    if (totalTokens <= budget) return diff; // already fits

    // Split raw diff into per-file sections on the git diff header boundary
    const fileSections = new Map<string, string>();
    const rawParts = diff.raw.split('\ndiff --git ');
    for (let i = 0; i < rawParts.length; i++) {
      const section = i === 0 ? rawParts[i]! : 'diff --git ' + rawParts[i]!;
      const m = section.match(/^diff --git a\/(.+?) b\//);
      if (m) fileSections.set(m[1]!, section);
    }

    // Sort: core first, boilerplate last — so reviewers see the important files
    const roleOrder = { core: 0, wiring: 1, boilerplate: 2 } as const;
    const sorted = [...diff.files].sort(
      (a, b) => (roleOrder[classifyFile(a.path)] ?? 1) - (roleOrder[classifyFile(b.path)] ?? 1),
    );

    // Greedy-pack: skip files that don't fit but keep trying smaller ones
    let used = 0;
    const kept = new Set<string>();
    for (const file of sorted) {
      const section = fileSections.get(file.path) ?? '';
      if (!section) continue;
      const tokens = this.container.tokenizer.count(section);
      if (used + tokens > budget) continue;
      kept.add(file.path);
      used += tokens;
    }

    const omitted = diff.files.length - kept.size;
    runLog.info(
      `diff budget: ${kept.size}/${diff.files.length} files kept (${used.toLocaleString()} / ${budget.toLocaleString()} tokens); ${omitted} low-priority file(s) omitted`,
    );

    return {
      files: diff.files.filter((f) => kept.has(f.path)),
      raw: [...kept].map((p) => fileSections.get(p) ?? '').join('\n'),
    };
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, findings: 0, grounding, cost_usd: null },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      context_documents: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
