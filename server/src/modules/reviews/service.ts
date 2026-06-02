import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  Intent,
  Provider,
  Review,
  RunEventKind,
  RunLogLine,
  RunTrace,
  SmartDiff,
  SmartDiffFile,
  UnifiedDiff,
} from '@devdigest/shared';
import { Intent as IntentSchema, Review as ReviewSchema } from '@devdigest/shared';
import { and, eq } from 'drizzle-orm';
import { assemblePrompt } from '../../platform/prompt.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import * as schema from '../../db/schema.js';
import { groundFindings, groundingSummary } from '../../platform/grounding.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { MemoryService } from '../memory/service.js';
import { AgentsRepository, type AgentRow } from '../agents/repository.js';
import { ReviewRepository, type FindingRow, type PullRow, type ReviewRow } from './repository.js';
import {
  DEFAULT_INTENT_MODEL,
  DEFAULT_INTENT_PROVIDER,
  FILE_MAP_THRESHOLD_LINES,
  INTENT_MAX_RETRIES,
  INTENT_SYSTEM_PROMPT,
  MEMORY_TOP_K,
  REVIEW_MAX_RETRIES,
  SMART_DIFF_ROLES,
  SPEC_CHUNK_LIMIT,
  SPLIT_TOO_BIG_FILES,
  SPLIT_TOO_BIG_LINES,
} from './constants.js';
import {
  classifyFile,
  findingMemoryContent,
  findingRowToDto,
  flagOutOfScope,
  memoryQuery,
  reduceReviews,
  reviewToDto,
  sliceDiff,
  sourcePr,
  taskLine,
  type ReviewDto,
  type ReviewDtoFinding,
} from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * A2 — Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + skills + memory + specs + diff)
 *        → MAP-REDUCE per changed file (token-limit resilience, §11)
 *        → llm.completeStructured({ schema: Review }) (dual-provider)
 *        → groundFindings(...) (MANDATORY citation gate, §8/§11)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc (§7) + an agent_runs row (A5 aggregates).
 *
 * Also: Intent layer (out-of-scope flagging), Smart Diff grouping + split
 * nudger, and the finding accept/dismiss/learn/reply actions.
 */

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

export class ReviewService {
  private repo: ReviewRepository;
  private agents: AgentsRepository;
  private memory: MemoryService;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = new AgentsRepository(container.db);
    this.memory = new MemoryService(container);
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

  /**
   * Run a review synchronously for each target agent. Each agent gets its own
   * runId (= agent_runs.id) that is created up-front so the SSE route can be
   * subscribed before/while the run progresses. A partial failure in one agent
   * does not abort the others (§11 resilience).
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const diff = await this.loadDiff(workspaceId, pull, repo);

    // Derive (or refresh) intent once for the PR; used to flag out-of-scope.
    let intent: Intent | undefined;
    try {
      intent = await this.deriveIntent(workspaceId, pull, diff, targets[0]);
    } catch {
      intent = await this.repo.getIntent(prId);
    }

    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const reviews: ReviewDto[] = [];

    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, agent, runId, intent);
        reviews.push(reviewToDto(outcome.review, outcome.findings, agent.name));
      } catch (err) {
        // Persist a failed run row + complete the bus so subscribers unblock.
        this.publish(runId, 'error', `Agent '${agent.name}' failed: ${(err as Error).message}`);
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
          })
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    }

    return { runs, reviews };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    intent: Intent | undefined,
  ): Promise<RunOutcome> {
    const start = Date.now();
    const log: RunLogLine[] = [];
    const record = (kind: RunEventKind, msg: string, data?: unknown) => {
      const e = this.publish(runId, kind, msg, data);
      log.push({ t: e.t, kind, msg });
    };

    record('info', `Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    // Resolve adapter, skills, memory, specs.
    const llm = await this.container.llm(agent.provider as Provider);
    const skillBodies = await this.collectSkills(agent.id);
    if (skillBodies.length > 0) record('info', `Loaded ${skillBodies.length} enabled skill(s)`);

    const memHits = await this.memory.retrieveMemory(workspaceId, memoryQuery(pull), {
      topK: MEMORY_TOP_K,
      repoId: pull.repoId,
    });
    if (memHits.length > 0) record('info', `Pulled ${memHits.length} relevant memory item(s)`);
    const memoryStrings = memHits.map((m) => m.content);
    const memoryPulled = memHits.map((m) => ({ pr: sourcePr(m), text: m.content }));

    const specs = await this.collectSpecs(workspaceId, pull.repoId);
    if (specs.length > 0) record('info', `Loaded ${specs.length} project-context spec(s)`);

    const task = taskLine(pull, intent);

    // ---- MAP: review each changed file (or the whole diff if small) -------
    const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
    const useMapReduce = totalLines > FILE_MAP_THRESHOLD_LINES && diff.files.length > 1;
    record(
      'info',
      useMapReduce
        ? `Large diff (${totalLines} lines) → map-reduce over ${diff.files.length} files`
        : `Reviewing ${diff.files.length} changed file(s) in one pass`,
    );

    const partials: Review[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd: number | null = 0;
    let rawOutputs: string[] = [];
    let assemblyForTrace = assemblePrompt({
      system: agent.systemPrompt,
      skills: skillBodies,
      memory: memoryStrings,
      specs,
      diff: diff.raw,
      task,
    }).assembly;

    const chunks: { label: string; diffText: string }[] = useMapReduce
      ? diff.files.map((f) => ({ label: f.path, diffText: sliceDiff(diff, f.path) }))
      : [{ label: 'all files', diffText: diff.raw }];

    for (const chunk of chunks) {
      record('tool', `map: reviewing ${chunk.label}`, { file: chunk.label });
      const { messages, assembly } = assemblePrompt({
        system: agent.systemPrompt,
        skills: skillBodies,
        memory: memoryStrings,
        specs,
        diff: chunk.diffText,
        task,
      });
      if (!useMapReduce) assemblyForTrace = assembly;
      const res = await llm.completeStructured<Review>({
        model: agent.model,
        schema: ReviewSchema,
        schemaName: 'Review',
        messages,
        maxRetries: REVIEW_MAX_RETRIES,
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
      rawOutputs.push(res.raw);
      partials.push(res.data);
      record('result', `${chunk.label}: ${res.data.findings.length} candidate finding(s)`);
    }

    // ---- REDUCE: merge partials into one Review ---------------------------
    const merged = reduceReviews(partials);
    record(
      'result',
      `Reduced to ${merged.findings.length} finding(s); verdict=${merged.verdict}, score=${merged.score}`,
    );

    // ---- Citation grounding (MANDATORY gate) ------------------------------
    const ground = groundFindings(merged.findings, diff);
    const grounding = groundingSummary(ground);
    if (ground.dropped.length > 0) {
      for (const d of ground.dropped) {
        record('info', `grounding dropped "${d.finding.title}": ${d.reason}`);
      }
    }
    record('result', `Citation grounding: ${grounding}`);

    // ---- Intent: flag out-of-scope findings (non-blocking) ----------------
    const keptFindings = flagOutOfScope(ground.kept, intent);

    // ---- Persist review + findings ----------------------------------------
    const review = await this.repo.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: agent.id,
      kind: 'review',
      verdict: merged.verdict,
      summary: merged.summary,
      score: merged.score,
      model: agent.model,
    });
    const findingRows = await this.repo.insertFindings(review.id, keptFindings);
    record('result', `Persisted review ${review.id} with ${findingRows.length} finding(s)`);

    const durationMs = Date.now() - start;

    // ---- Observability: agent_runs + ONE run_traces document --------------
    await this.repo.completeAgentRun(runId, {
      status: 'done',
      durationMs,
      tokensIn,
      tokensOut,
      costUsd,
      findingsCount: findingRows.length,
      grounding,
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
      prompt_assembly: assemblyForTrace,
      tool_calls: chunks.map((c) => ({
        tool: 'review_file',
        args: c.label,
        meta: useMapReduce ? 'map-reduce' : 'single-pass',
        ms: Math.round(durationMs / chunks.length),
      })),
      raw_output: rawOutputs.join('\n---\n'),
      memory_pulled: memoryPulled,
      specs_read: specs.length > 0 ? specs.map((_, i) => `spec-${i}`) : [],
      log,
    };
    await this.repo.saveRunTrace(runId, trace);
    record('info', 'Run complete; trace persisted');
    this.container.runBus.complete(runId);

    return { review, findings: findingRows, grounding, raw: merged };
  }

  // ===========================================================================
  // Intent layer
  // ===========================================================================

  async deriveIntent(
    workspaceId: string,
    pull: PullRow,
    diff: UnifiedDiff,
    agent?: AgentRow,
  ): Promise<Intent> {
    const provider = (agent?.provider as Provider) ?? DEFAULT_INTENT_PROVIDER;
    const llm = await this.container.llm(provider);
    const { messages } = assemblePrompt({
      system: INTENT_SYSTEM_PROMPT,
      diff: diff.raw,
      task: taskLine(pull, undefined),
    });
    const res = await llm.completeStructured<Intent>({
      model: agent?.model ?? DEFAULT_INTENT_MODEL,
      schema: IntentSchema,
      schemaName: 'Intent',
      messages,
      maxRetries: INTENT_MAX_RETRIES,
    });
    await this.repo.upsertIntent(pull.id, res.data);
    return res.data;
  }

  async getIntent(workspaceId: string, prId: string): Promise<Intent | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.repo.getIntent(prId);
  }

  // ===========================================================================
  // Smart Diff + Split Nudger
  // ===========================================================================

  /**
   * Group changed files into core / wiring / boilerplate by heuristics, annotate
   * with finding-lines from persisted findings, and suggest a split when the PR
   * is too big (§7 split nudger). No LLM call required (deterministic, cheap).
   */
  async smartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const files = await this.repo.getPrFiles(prId);

    // finding-lines per file (from the latest reviews)
    const reviews = await this.repo.reviewsForPull(prId);
    const findingLinesByFile = new Map<string, Set<number>>();
    for (const { findings } of reviews) {
      for (const f of findings) {
        const set = findingLinesByFile.get(f.file) ?? new Set<number>();
        for (let n = f.startLine; n <= f.endLine; n++) set.add(n);
        findingLinesByFile.set(f.file, set);
      }
    }

    const groups: Record<'core' | 'wiring' | 'boilerplate', SmartDiffFile[]> = {
      core: [],
      wiring: [],
      boilerplate: [],
    };
    let totalLines = 0;
    for (const f of files) {
      const additions = f.additions ?? 0;
      const deletions = f.deletions ?? 0;
      totalLines += additions + deletions;
      const role = classifyFile(f.path);
      const findingLines = [...(findingLinesByFile.get(f.path) ?? [])].sort((a, b) => a - b);
      groups[role].push({
        path: f.path,
        pseudocode_summary: null,
        additions,
        deletions,
        finding_lines: findingLines,
      });
    }

    const tooBig = totalLines > SPLIT_TOO_BIG_LINES || files.length > SPLIT_TOO_BIG_FILES;
    const proposed = tooBig
      ? SMART_DIFF_ROLES.filter((role) => groups[role].length > 0).map((role) => ({
          name: `${role} changes`,
          files: groups[role].map((g) => g.path),
        }))
      : [];

    return {
      groups: SMART_DIFF_ROLES.filter((role) => groups[role].length > 0).map((role) => ({
        role,
        files: groups[role],
      })),
      split_suggestion: { too_big: tooBig, total_lines: totalLines, proposed_splits: proposed },
    };
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
    reply?: string,
  ): Promise<{ finding: ReviewDtoFinding; memoryId?: string }> {
    const ctx = await this.repo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, pull } = ctx;

    switch (action) {
      case 'accept': {
        const row = await this.repo.setFindingAccepted(findingId, new Date());
        return { finding: findingRowToDto(row!) };
      }
      case 'dismiss': {
        const row = await this.repo.setFindingDismissed(findingId, new Date());
        return { finding: findingRowToDto(row!) };
      }
      case 'learn': {
        // Create a kind='learning' memory row via A1's MemoryService (§7 AC).
        const content = findingMemoryContent(finding, reply);
        const mem = await this.memory.learnFromFinding(workspaceId, {
          content,
          repoId: pull.repoId,
          prNumber: pull.number,
          context: `Learned from finding "${finding.title}" on PR #${pull.number}`,
        });
        // Learning also implies accepting the finding's signal.
        const row = await this.repo.setFindingAccepted(findingId, new Date());
        return { finding: findingRowToDto(row!), memoryId: mem.id };
      }
      case 'reply': {
        if (!reply) throw new AppError('reply_required', 'reply text is required', 400);
        // Store the reply as a memory note scoped to the repo (provenance: the PR).
        const mem = await this.memory.create(workspaceId, {
          content: `Reply on finding "${finding.title}" (PR #${pull.number}): ${reply}`,
          scope: 'repo',
          kind: 'preference',
          confidence: 0.6,
          sources: [{ pr: pull.number, context: 'Reviewer reply to a finding' }],
          repoId: pull.repoId,
        });
        return { finding: findingRowToDto(finding), memoryId: mem.id };
      }
      default:
        throw new AppError('invalid_action', `Unknown action '${action}'`, 400);
    }
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

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
   * back to assembling a synthetic unified diff from the persisted pr_files
   * patches (so the reviewer works even before a clone completes / in tests).
   */
  private async loadDiff(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
  ): Promise<UnifiedDiff> {
    try {
      const diff = await this.container.git.diff(
        { owner: repo.owner, name: repo.name },
        pull.base,
        pull.headSha,
      );
      if (diff.files.length > 0) return diff;
    } catch {
      /* fall through to pr_files reconstruction */
    }
    return this.diffFromPrFiles(pull.id);
  }

  /** Reconstruct a UnifiedDiff from persisted pr_files patches. */
  private async diffFromPrFiles(prId: string): Promise<UnifiedDiff> {
    const files = await this.repo.getPrFiles(prId);
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

  private async collectSkills(agentId: string): Promise<string[]> {
    const links = await this.agents.linkedSkills(agentId);
    return links
      .filter((l) => l.skill.enabled)
      .map((l) => `### ${l.skill.name}\n${l.skill.body}`);
  }

  /** Pull project-context spec chunks for the repo (source='spec'); capped. */
  private async collectSpecs(_workspaceId: string, repoId: string): Promise<string[]> {
    try {
      const rows = await this.container.db
        .select({ content: schema.codeChunks.content })
        .from(schema.codeChunks)
        .where(and(eq(schema.codeChunks.repoId, repoId), eq(schema.codeChunks.source, 'spec')))
        .limit(SPEC_CHUNK_LIMIT);
      return rows.map((r) => r.content);
    } catch {
      return [];
    }
  }
}
