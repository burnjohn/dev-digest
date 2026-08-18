import type { Container } from '../../platform/container.js';
import type {
  Intent,
  IntentClassificationStats,
  PromptSection,
  PromptSectionSize,
  Provider,
  Review,
  RunTrace,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, countBlockers, severityCounts } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { IntentClassifier } from './intent-classifier.js';

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

/**
 * Human-readable origin per prompt section, for the structured assembly log
 * below. Static metadata only — never derived from section content, so
 * logging it can never leak a spec, a diff line, or a secret.
 */
const PROMPT_SECTION_SOURCE: Record<PromptSection, string> = {
  system: 'agent system prompt',
  skills: 'linked skills (user-enabled)',
  memory: 'curated memory',
  specs: 'project context (repo-intel)',
  callers: 'callers digest (repo-intel)',
  repo_map: 'repo skeleton (repo-intel)',
  pr_description: 'PR body (GitHub, author-supplied)',
  intent: 'Intent Layer classifier (cached or fresh)',
  diff: 'PR diff (GitHub)',
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
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  private intentClassifier: IntentClassifier;

  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {
    this.intentClassifier = new IntentClassifier(container);
  }

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

    // PR Intent Layer — classify ONCE per PR, then cache. A cached intent is
    // reused even if headSha has moved since (that's the manual-refresh
    // route's job, not this path's); best-effort — a classification failure
    // never fails the review, it just runs without an intent digest.
    const { intent, intentStats } = await this.loadOrClassifyIntent(workspaceId, pull, repo, diff, runLog);

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          runLog,
          intent,
          intentStats,
        );
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
    intent: Intent | undefined,
    intentStats: IntentClassificationStats | null,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

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

      // Skills — the agent's linked, enabled skill bodies, in configured order.
      // Unlike the repo-intel enrichments above this is NOT best-effort: a
      // review that silently ran without the rules the user attached is a wrong
      // review, not a degraded one, so a failure here fails the run.
      const skills = await runLog.step(
        'Resolving linked skills',
        () => this.agents.enabledSkillsForPrompt(workspaceId, agent.id),
        { kind: 'tool' },
      );
      if (skills.length > 0) {
        runLog.info(`Skills in prompt (${skills.length}): ${skills.map((s) => s.name).join(', ')}`);
      } else {
        runLog.info('No enabled skills linked to this agent — prompt has no skills block');
      }
      // Recorded BEFORE the model call, deliberately: this is the only queryable
      // record of "which skills were in which run" (the trace only holds
      // concatenated skill bodies, no ids), and a run that fails downstream
      // still used exactly this prompt — the record should say so too.
      await this.repo.recordSkillsUsed(
        runId,
        skills.map((sk) => ({ id: sk.id, version: sk.version })),
      );

      const task = taskLine(pull) + rankNote;

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // Resolved skill bodies (not slugs). Omitted when empty so an agent with
        // no skills produces a prompt byte-identical to the pre-skills one —
        // which is exactly what makes the with/without comparison meaningful.
        ...(skills.length > 0 ? { skills: skills.map((s) => s.body) } : {}),
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // PR Intent Layer — rendered digest for the prompt, plus the
        // structured out_of_scope list for the post-grounding scope-check
        // gate. Omitted when no intent is cached/classified for this PR.
        ...(intent
          ? { intent: this.renderIntentDigest(intent), intentOutOfScope: intent.out_of_scope }
          : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      this.logPromptAssembly(runLog, runId, outcome.assembly.section_sizes ?? [], agent);

      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

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

      // Fold this run's demoted-CRITICAL "risk area" signals back onto the
      // cached intent (deterministic, computed in reviewer-core — never
      // self-reported by the review model). Overwrites risk_areas with THIS
      // run's set (incl. clearing it to [] when nothing was demoted) so it
      // always reflects the latest review, not a stale earlier one.
      if (intent) {
        await this.repo.upsertIntent(pull.id, { ...intent, risk_areas: outcome.riskAreas });
        if (outcome.riskAreas.length > 0) {
          runLog.info(`Risk areas outside declared scope: ${outcome.riskAreas.join(' | ')}`);
        }
      }

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);
      const counts = severityCounts(keptFindings);

      // ---- Observability: agent_runs + ONE run_traces document --------------
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        criticalCount: counts.CRITICAL,
        warningCount: counts.WARNING,
        suggestionCount: counts.SUGGESTION,
        error: null,
      });

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        // Present only on the run(s) that shared THIS batch's fresh
        // classification; null when the intent was already cached (no new
        // LLM call was made) or none was available at all.
        intent_stats: intentStats,
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * PR Intent Layer — load the cached intent, or classify once and cache it
   * (first review on a PR). A cached intent is reused EVEN IF `headSha` has
   * moved since it was computed; only the manual `POST /pulls/:id/intent/
   * refresh` route re-classifies. Best-effort: a classification failure logs
   * and continues without an intent digest — it must never fail the review.
   */
  private async loadOrClassifyIntent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<{ intent: Intent | undefined; intentStats: IntentClassificationStats | null }> {
    try {
      const cached = await this.intentClassifier.getCached(pull.id);
      if (cached) {
        runLog.info(`Intent: using cached classification (confidence=${cached.confidence})`);
        return { intent: cached, intentStats: null };
      }
      const result = await runLog.step(
        'Classifying PR intent',
        () => this.intentClassifier.classify(workspaceId, pull, repo, diff),
        { kind: 'tool' },
      );
      runLog.info(
        `Intent classified (confidence=${result.intent.confidence}, model=${result.stats.provider}/${result.stats.model}, ` +
          `~${result.stats.tokensIn + result.stats.tokensOut} tok) — signals: ${result.signalsUsed.join(', ')}`,
      );
      const intentStats: IntentClassificationStats = {
        provider: result.stats.provider,
        model: result.stats.model,
        tokens_in: result.stats.tokensIn,
        tokens_out: result.stats.tokensOut,
        cost_usd: result.stats.costUsd,
      };
      return { intent: result.intent, intentStats };
    } catch (err) {
      // Never let intent classification break the run — the review still
      // runs, just without an intent digest / scope-check gate this time.
      runLog.info(`Intent classification skipped — ${(err as Error).message}`);
      return { intent: undefined, intentStats: null };
    }
  }

  /**
   * Structured, content-free log of how this run's prompt was assembled.
   *
   * Always emits ONE compact summary line (section count / total size /
   * model) — safe at any log level. Per-section rows (name, source, chars,
   * est_tokens) are additionally emitted only when
   * `config.promptAssemblyVerboseLog` is on, which is hard-restricted to
   * local development (see `platform/config.ts`).
   *
   * Every line only ever carries `PromptSectionSize` (name + chars +
   * est_tokens, computed purely in reviewer-core) and static labels from
   * `PROMPT_SECTION_SOURCE` — never the section's actual text, so a spec, a
   * diff line, or a secret can never end up in this log by construction.
   * `runLog.event()` already merges `runIds`/`ctx` into every line, so the
   * run id (correlation id) is present without repeating it here.
   */
  private logPromptAssembly(
    runLog: RunLogger,
    runId: string,
    sections: PromptSectionSize[],
    agent: AgentRow,
  ): void {
    const totalChars = sections.reduce((sum, s) => sum + s.chars, 0);
    const totalEstTokens = sections.reduce((sum, s) => sum + s.est_tokens, 0);
    runLog.info(
      `Prompt assembled: ${sections.length} section(s), ~${totalEstTokens} est. tokens (${agent.provider}/${agent.model})`,
      { runId, sectionCount: sections.length, totalChars, totalEstTokens, provider: agent.provider, model: agent.model },
    );

    if (!this.container.config.promptAssemblyVerboseLog) return;
    for (const { section, chars, est_tokens } of sections) {
      runLog.info(`prompt section "${section}": ${chars} chars (~${est_tokens} tok)`, {
        runId,
        section,
        source: PROMPT_SECTION_SOURCE[section],
        chars,
        est_tokens,
        provider: agent.provider,
        model: agent.model,
      });
    }
  }

  /** Render a cached/classified Intent into the untrusted prompt digest. */
  private renderIntentDigest(intent: Intent): string {
    const lines = [`Intent: ${intent.intent}`];
    if (intent.in_scope.length > 0) lines.push(`In scope: ${intent.in_scope.join(', ')}`);
    if (intent.out_of_scope.length > 0) lines.push(`Out of scope: ${intent.out_of_scope.join(', ')}`);
    lines.push(`Confidence: ${intent.confidence}`);
    return lines.join('\n');
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
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
