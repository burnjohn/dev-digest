import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import type {
  PrIntentDetail,
  Provider,
  Review,
  RunTrace,
  SpecManifestEntry,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import { approxTokens } from '../../adapters/tokenizer/index.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { intentPromptBlock, selectSkillBodies, taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';

/**
 * The minimal surface `ReviewRunExecutor` needs from `ReviewService` for PR
 * intent (plan 03-intent-layer.md T6). A structural interface — NOT an
 * import of `ReviewService` — so this file stays free of a runtime cycle with
 * `service.ts` (which already imports `ReviewRunExecutor`). `ReviewService`
 * satisfies this with no wrapper: it has a `getOrClassifyIntent` method of
 * this exact shape.
 */
export interface IntentProvider {
  getOrClassifyIntent(
    workspaceId: string,
    prId: string,
    opts?: { force?: boolean; log?: RunLogger; correlationId?: string },
  ): Promise<PrIntentDetail>;
}

/**
 * Ceiling on the do-not-report list sent to the model. A PR where dozens of
 * findings were dismissed would otherwise spend the diff's token budget listing
 * them; `buildSuppressions` logs whenever it truncates, so a dropped entry is
 * stated rather than silent.
 */
const MAX_SUPPRESSIONS = 50;

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
    private intentProvider: IntentProvider,
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
    // One correlation id per `executeRuns` invocation (NOT per agent run) —
    // the only scalar that spans the shared pre-work (diff + intent) AND every
    // per-agent reviewer line, so one review invocation can be grepped out of
    // stdout without an array-contains join on `runIds`. Seeded into the
    // RunLogger's base ctx (mirrored to every child via `forRun`'s spread) and
    // ALSO passed explicitly in each structured log payload below, since the
    // ctx merge only reaches the pino stdout mirror, never the SSE `data`.
    const correlationId = randomUUID();

    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id, correlationId },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        // Trace FIRST, status second — see the note in `runOneAgent`: a terminal
        // `agent_runs` row must never be observable before the `run_traces`
        // document it implies, or GET /runs/:id/trace 404s on a finished run.
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
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

    // ---- PR intent (plan 03-intent-layer.md T6, REQ-7) ---------------------
    // Cache-first via the SAME service function GET/POST /pulls/:id/intent
    // use (REQ-8/D4): a PR whose intent already exists costs nothing here, and
    // a multi-agent run classifies at most once. This step must NEVER fail
    // the run — model resolution, LLM error, and persistence failures are all
    // covered (`getOrClassifyIntent`'s own DB reads/writes and
    // `resolveFeatureModel` are the parts NOT already caught inside
    // `classifyIntent`, which never throws). Contrast this deliberately with
    // the linked-skills block in `runOneAgent`, which IS allowed to throw:
    // skills are the user's own instructions; intent is enrichment. A silent
    // fail-open would hide a feature that never ran (server/INSIGHTS.md,
    // 2026-08-17), so the degradation is logged explicitly, not swallowed.
    let intent: string | undefined;
    try {
      const detail = await runLog.step(
        'Deriving PR intent',
        () =>
          this.intentProvider.getOrClassifyIntent(workspaceId, pull.id, {
            force: false,
            log: runLog,
            correlationId,
          }),
        { kind: 'tool' },
      );
      intent = intentPromptBlock(detail);
      runLog.info(
        `Intent composed: confidence=${detail.confidence}, ${detail.in_scope.length} in-scope item(s), ` +
          `${detail.out_of_scope.length} out-of-scope item(s), ${intent.length} char(s)`,
      );
    } catch (err) {
      runLog.error(`Failed to derive PR intent — continuing without it: ${(err as Error).message}`);
    }

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
          correlationId,
          intent,
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
    correlationId: string,
    intent?: string,
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

      const task = taskLine(pull) + rankNote;

      // ---- L02: linked skills → the "## Skills / rules" prompt section -------
      // `linkedSkills` returns joined skill rows already ordered by
      // `agent_skills.order` ASC, so link order IS prompt order. No cross-module
      // import needed — `this.agents` is the agents REPOSITORY, held by the
      // container.
      //
      // Failure policy: let it throw. This is deliberately the opposite of the
      // repo-intel calls above, which degrade to `undefined` on error. Repo intel
      // is enrichment — a review without it is merely thinner. Skills are the
      // user's own instructions, so a review that silently ran without the rubric
      // they attached is WRONG, not degraded. The catch in this method persists a
      // failed run with the error text, which is the honest outcome.
      const linkedSkills = await this.agents.linkedSkills(agent.id);
      const skills = selectSkillBodies(linkedSkills);
      const disabledCount = linkedSkills.length - skills.length;

      if (linkedSkills.length === 0) {
        runLog.info('No skills linked to this agent — prompt has no "## Skills / rules" section');
      } else {
        const activeNames = linkedSkills
          .filter((l) => l.skill.enabled)
          .map((l) => l.skill.name)
          .join(', ');
        runLog.info(
          `Skills: ${skills.length}/${linkedSkills.length} enabled${activeNames ? ` — ${activeNames}` : ''}`,
        );
        if (disabledCount > 0) {
          const disabledNames = linkedSkills
            .filter((l) => !l.skill.enabled)
            .map((l) => l.skill.name)
            .join(', ');
          runLog.info(`Skipped ${disabledCount} disabled skill(s): ${disabledNames}`);
        }
        if (skills.length > 0) {
          // Char count, never bodies. Under map-reduce `assemblePrompt` runs once
          // per changed file, so this cost is paid per call, not per run — and the
          // trace stores only the whole-diff assembly, so it under-reports.
          const chars = skills.reduce((n, b) => n + b.length, 0);
          const perCall = (agent.strategy ?? REVIEW_STRATEGY) === 'single-pass' ? '' : ' per model call';
          runLog.info(
            `Injecting ${skills.length} skill(s) (${chars} chars) into the prompt${perCall}`,
          );
        }
      }

      // ---- SPEC-01 T12: project-context documents → prompt `specs` slot -----
      // REQ-18: `container.contextDocs.resolveEffectiveAttachments` is the
      // SINGLE resolution rule (the agent's own attachments, then each
      // ENABLED linked skill's, restricted to this repo, de-duplicated by
      // path keeping the earliest occurrence) — consumed through the port,
      // never re-derived here and never reached by importing `modules/context`
      // directly (onion §2 rule 2).
      //
      // Failure policy: SKIP, not throw — the opposite of `linkedSkills`
      // above. A document path points at a working tree that can legitimately
      // move out from under the attachment (a rebase, a resync); a skill body
      // is a row this run owns. `server/INSIGHTS.md`'s "silent fail-open"
      // entry (2026-08-17) still holds — what it forbids is the SILENCE, not
      // the skip — so a missing document is recorded as a typed `missing`
      // manifest entry (AC-23/AC-27) rather than dropped unremarked.
      // ---- Dismissed findings on THIS PR -> prompt `suppressions` slot ------
      // Read-only, and non-fatal by construction: an empty list omits the slot
      // entirely, so a review whose author never dismissed anything assembles
      // exactly the prompt it did before this feature existed.
      const suppressions = await this.buildSuppressions(pull.id, runLog);

      const { specs, specsRead, specsManifest } = await this.buildProjectContext(
        agent.id,
        repo,
        workspaceId,
        runLog,
      );

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
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // Findings the owner already dismissed on this PR — trusted, rendered
        // un-wrapped beside the diff with a matching system directive. Same
        // omit-when-empty contract as every slot around it.
        ...(suppressions.length > 0 ? { suppressions } : {}),
        // L02 — linked, enabled skill bodies in link order. Same omit-when-empty
        // contract: with no skills the assembled prompt is byte-identical to
        // before this feature existed.
        ...(skills.length > 0 ? { skills } : {}),
        // SPEC-01 T12 — the agent's effective project-context documents, each
        // already formatted as T5's `### <path>` block. Same omit-when-empty
        // contract: with no attached (or all-missing) documents the assembled
        // prompt is byte-identical to before this feature existed (REQ-20).
        ...(specs.length > 0 ? { specs } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // T6 — the declared PR intent (untrusted, delimiter-wrapped). Same
        // omit-when-empty contract: a run whose intent step degraded (or
        // whose intent is empty) assembles a prompt identical to today's
        // (REQ-11).
        ...(intent ? { intent } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      // ---- Safe, structured prompt-assembly log (metadata only) -------------
      // Names/refs/statuses/model ids/integer lengths — NEVER content. Never
      // logged: any `outcome.assembly.*` string value, `task`, `diff.raw`, or
      // `pull.body` — only `.length` of each is measured, then the text is
      // discarded (never placed on the log object). See the privacy invariant
      // in this module's owning plan (06-prompt-logging).
      //
      // Two honesty caveats, encoded in the DATA (not only in this comment):
      //   1. `system`'s `source` label states inline whether it includes the
      //      injection guard / scope directive, so its length is understood to
      //      over-report the agent's own systemPrompt.
      //   2. Under map-reduce, `outcome.assembly` is the WHOLE-DIFF assembly —
      //      never sent to the model as-is (real calls are per-chunk, and only
      //      `diff`/`user` vary across chunks; every other slot is identical).
      //      `mode` + `chunks` are logged alongside so a reader can multiply.
      const assembly = outcome.assembly;
      const sectionText: Record<string, string> = {
        system: assembly.system,
        skills: assembly.skills ?? '',
        memory: assembly.memory ?? '',
        specs: assembly.specs ?? '',
        repo_map: assembly.repo_map ?? '',
        callers: assembly.callers ?? '',
        pr_description: assembly.pr_description ?? '',
        intent: assembly.intent ?? '',
        task,
        diff: diff.raw,
        user: assembly.user,
      };
      const sectionSource: Record<string, string> = {
        system: `agent systemPrompt + INJECTION_GUARD${intent ? ' + SCOPE_DIRECTIVE' : ''}`,
        skills: 'linked skills',
        memory: 'retrieval',
        specs: 'retrieval',
        repo_map: 'repo-intel',
        callers: 'repo-intel',
        pr_description: 'PR body',
        intent: 'pr_intent',
        task: 'local',
        diff: 'diff.raw',
        user: 'joined user message',
      };
      const sections = Object.entries(sectionText).map(([name, text]) => ({
        name,
        source: sectionSource[name]!,
        chars: text.length,
        tokens: approxTokens(text),
      }));
      runLog.info('Prompt composed', {
        correlationId,
        runId,
        agent: agent.name,
        provider: agent.provider,
        model: agent.model,
        mode: outcome.mode,
        chunks: outcome.chunks.length,
        sections,
        // REQ-44 — paths/statuses/hashes/integer lengths only, NEVER a
        // document body (NFR-8); omitted entirely (not an empty array) for a
        // zero-attachment run, mirroring `specs_manifest`'s own contract below.
        ...(specsManifest.length > 0 ? { specsManifest } : {}),
      });

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

      // ---- Observability: ONE run_traces document + agent_runs --------------
      // Trace FIRST, status second. The terminal `agent_runs` row is what every
      // consumer waits on (SSE aside — `runBus.complete` fires below); writing
      // it first opens a window where a run reads as `done` but
      // GET /runs/:id/trace still 404s. Keep this order on all three paths.
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
          findings: findingRows.length,
          grounding,
          cost_usd: costUsd,
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
        specs_read: specsRead,
        // AC-26/AC-27 — one entry per document in the effective list, in
        // effective order; omitted (never an empty array) when the effective
        // list itself was empty, following `cost_usd`'s existing `.nullish()`
        // precedent on `RunStats` (`contracts/trace.ts`) so every already-
        // stored trace keeps parsing.
        ...(specsManifest.length > 0 ? { specs_manifest: specsManifest } : {}),
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      await this.repo.saveRunTrace(runId, trace);
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        costUsd,
        error: null,
      });
      runLog.info('Run complete; trace persisted');
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
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
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
   * SPEC-01 T12 — resolve the agent's effective project-context documents
   * (REQ-18, via `container.contextDocs`), read each one's CURRENT text from
   * disk, and build the `specs` blocks + the `specs_read`/`specs_manifest`
   * pair for the persisted trace (AC-20/AC-21/AC-26/AC-27).
   *
   * A document may live under the repository clone OR the upload directory
   * — `resolveEffectiveAttachments` returns bare paths with no root hint, so
   * both roots are tried in turn, exactly the pattern `ContextService` itself
   * already uses internally (`service.ts`'s `previewDocument` /
   * `statAttachedPath`). Degradation is a SKIP — see the call site's comment
   * and SPEC-01 `## Module interactions` for why this diverges from
   * `linkedSkills`'s let-it-throw policy.
   *
   * REQ-25/REQ-39: issues no LLM completion, no embedding request, and at
   * most one successful filesystem read plus one SHA-256 — over the exact
   * bytes read, never re-derived or normalised — per attached document.
   */
  /**
   * Findings the owner DISMISSED on this same pull request, as the trusted
   * do-not-report list `reviewer-core` renders beside the diff.
   *
   * Scope is deliberately ONE pull request. A dismissal is anchored to line
   * numbers on the diff it was made against, so carrying it to a different PR
   * needs a stable key (file + rule + symbol) and a staleness policy — an
   * unsolved design question, not something to improvise here. Within one PR
   * the anchor is exactly as valid as it was when the owner clicked Dismiss,
   * which makes re-running an agent stop re-surfacing what was already rejected.
   *
   * Location only, never the finding's `title`: a title is model-generated text
   * derived from an untrusted diff, and this list is rendered in the TRUSTED
   * half of the prompt (`prompt.ts` SUPPRESSION_DIRECTIVE).
   *
   * The window is the finding's own lines, UNPADDED — unlike the eval seed
   * (`eval-draft.ts` EXPECTATION_LINE_PADDING), whose padding exists because a
   * mechanical scorer compares ranges. Here the reader is the model, and
   * widening the window would hand it a licence to stay quiet over lines nobody
   * dismissed.
   */
  private async buildSuppressions(prId: string, runLog: RunLogger): Promise<string[]> {
    const reviews = await this.repo.reviewsForPull(prId);
    const seen = new Set<string>();
    for (const { findings } of reviews) {
      for (const finding of findings) {
        if (finding.dismissedAt == null) continue;
        seen.add(`${finding.file}:${finding.startLine}-${finding.endLine}`);
      }
    }
    const all = [...seen].sort();
    // Never a silent cap: a truncated list is stated in the run log, so a
    // suppression that did not reach the model is visible rather than inferred.
    const suppressions = all.slice(0, MAX_SUPPRESSIONS);
    if (all.length > suppressions.length) {
      runLog.info(
        `Dismissed findings: sending ${suppressions.length} of ${all.length} (capped) as do-not-report locations`,
      );
    } else if (suppressions.length > 0) {
      runLog.info(`Dismissed findings: sending ${suppressions.length} do-not-report location(s)`);
    }
    return suppressions;
  }

  private async buildProjectContext(
    agentId: string,
    repo: typeof schema.repos.$inferSelect,
    workspaceId: string,
    runLog: RunLogger,
  ): Promise<{ specs: string[]; specsRead: string[]; specsManifest: SpecManifestEntry[] }> {
    const paths = await this.container.contextDocs.resolveEffectiveAttachments(agentId, repo.id);
    if (paths.length === 0) {
      return { specs: [], specsRead: [], specsManifest: [] };
    }

    const cloneDirAbs = this.container.git.clonePathFor({ owner: repo.owner, name: repo.name });
    const uploadDirAbs = join(this.container.config.contextUploadDir, workspaceId, repo.id);

    const specs: string[] = [];
    const specsRead: string[] = [];
    const specsManifest: SpecManifestEntry[] = [];

    for (const path of paths) {
      const found =
        (await this.container.contextDocs.readDocument(cloneDirAbs, path)) ??
        (await this.container.contextDocs.readDocument(uploadDirAbs, path));
      if (!found) {
        specsManifest.push({ path, status: 'missing', sha256: null, chars: null });
        continue;
      }
      specs.push(found.block);
      specsRead.push(path);
      specsManifest.push({
        path,
        status: 'read',
        sha256: createHash('sha256').update(found.body, 'utf8').digest('hex'),
        chars: found.body.length,
      });
    }

    const missing = specsManifest.filter((m) => m.status === 'missing').map((m) => m.path);
    runLog.info(
      missing.length > 0
        ? `Project context: ${specsRead.length}/${paths.length} document(s) read; missing: ${missing.join(', ')}`
        : `Project context: ${specsRead.length} document(s) attached`,
    );

    return { specs, specsRead, specsManifest };
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
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
