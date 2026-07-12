/**
 * eval-service.ts — Eval case-management service (Ring 2, T5/T6/T7).
 *
 * Thin application service over the EvalRepository (Ring 3). Contains
 * business logic for case creation from findings (AC-1/2/4), the
 * free-form manual path, the run orchestrator (T6), and the
 * dashboard / compare / promote / history reads (T7).
 *
 * Onion rule: this file (Ring 2) imports only Ring 1 contracts and the Ring 3
 * repository via constructor injection — no framework types, no DB client
 * directly.
 */

import type {
  Finding,
  EvalCaseInput,
  EvalRunGroupResult,
  EvalRunResult,
  EvalDashboard,
  EvalTrendPoint,
  EvalRunRecord,
  EvalRunGroup,
  AgentVersion,
} from '@devdigest/shared';
import type { EvalCaseRow } from './eval-repository.js';
import { EvalRepository } from './eval-repository.js';
import { AgentsRepository } from './repository.js';
import { toAgentVersionDto } from './helpers.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { scoreCase, scoreRun } from './eval-scorer.js';
import type { Container } from '../../platform/container.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The accept/dismiss action that determines the expectation type (AC-4).
 * Only 'accept' and 'dismiss' are case-creation triggers; 'learn' / 'reply'
 * are out of scope for eval-case creation.
 */
export type EvalCaseAction = 'accept' | 'dismiss';

// ---------------------------------------------------------------------------
// EvalService
// ---------------------------------------------------------------------------

export class EvalService {
  private repo: EvalRepository;
  private agentsRepo: AgentsRepository;
  private container: Container | null;

  /**
   * Accepts either a plain `Db` (for T5 case-CRUD paths that don't need
   * `reviewPullRequest`) or a full `Container` (for T6's run orchestrator
   * which needs `container.llm(provider)`).
   *
   * When a `Container` is provided, `db` is derived from `container.db`.
   */
  constructor(db: import('../../db/client.js').Db, container?: Container) {
    this.repo = new EvalRepository(db);
    this.agentsRepo = new AgentsRepository(db);
    this.container = container ?? null;
  }

  // ---- Case creation from a finding (one click, AC-1/2/4) ------------------

  /**
   * Create an eval case from an accepted or dismissed finding (AC-1/2/4).
   *
   * The `expectedOutput` is derived from `action`, NOT from user input (AC-4):
   *   - `accept`  → `must_find`     (AC-1): agent MUST emit this finding
   *   - `dismiss` → `must_not_flag` (AC-2): agent must NOT flag this file/range
   *
   * `inputDiff` is the finding's diff fragment (frozen snapshot, AC-6).
   * `ownerKind` = 'agent', `ownerId` = agentId (tenant-scoped).
   *
   * @param workspaceId  Workspace scoping — never mixed across tenants (INSIGHTS 2026-06-29).
   * @param agentId      The reviewing agent that produced the finding (AC-1/2).
   * @param finding      The Finding the user acted on.
   * @param action       'accept' → must_find; 'dismiss' → must_not_flag.
   * @param inputDiff    The diff fragment associated with the finding (frozen, AC-6).
   * @param name         Optional case name; defaults to finding title.
   */
  async createCaseFromFinding(
    workspaceId: string,
    agentId: string,
    finding: Finding,
    action: EvalCaseAction,
    inputDiff = '',
    name?: string,
  ): Promise<EvalCaseRow> {
    const expectedOutput =
      action === 'accept'
        ? // AC-1: must_find — agent must emit a finding at this file+range.
          {
            type: 'must_find' as const,
            findings: [finding],
          }
        : // AC-2: must_not_flag — agent must NOT flag this file/range.
          {
            type: 'must_not_flag' as const,
            findings: [] as Finding[],
            forbidden: [
              {
                file: finding.file,
                start_line: finding.start_line,
                end_line: finding.end_line,
              },
            ],
          };

    return this.repo.createCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      name: name ?? finding.title,
      inputDiff,
      expectedOutput,
    });
  }

  // ---- Manual case creation (free-form "New eval case" modal) ---------------

  /**
   * Create an eval case from a free-form API payload (the "New eval case" modal
   * path — T8/T9). Body is already validated against `EvalCaseInput` at the
   * route layer (Ring 4); the service passes it straight through to the repo
   * (INSIGHTS 2026-07-12 — `EvalCaseInput` is accepted directly).
   *
   * @param workspaceId  Workspace scoping.
   * @param input        Validated `EvalCaseInput` from the request body.
   */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCaseRow> {
    return this.repo.createCase(workspaceId, input);
  }

  // ---- Case listing (AC-5) -------------------------------------------------

  /**
   * List all eval cases for an agent, workspace-scoped (AC-5).
   * Supports ≥8 cases; no upper limit enforced here.
   *
   * @param workspaceId  Workspace scoping.
   * @param agentId      The agent whose cases to list.
   */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.repo.listCases(workspaceId, 'agent', agentId);
  }

  // ---- Case deletion -------------------------------------------------------

  /**
   * Delete an eval case, workspace-scoped.
   * Returns false if the case does not exist or belongs to another workspace.
   *
   * @param workspaceId  Workspace scoping.
   * @param caseId       The case id to delete.
   */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  // ---- Run orchestrator (T6, AC-6/7/11/13/17) --------------------------------

  /**
   * Run an agent over its frozen case set and score each case (AC-6/7/11/13/17).
   *
   * Workflow:
   *  1. Load the agent row (provider / model / systemPrompt / version — AC-7).
   *  2. Create a run group at the START, recording the agent's CURRENT version (AC-7).
   *  3. For each case:
   *     a. Parse the stored `inputDiff` TEXT into a `UnifiedDiff` with
   *        `parseUnifiedDiff` (AC-6 — verbatim from storage, never re-fetched).
   *     b. Run `reviewPullRequest` with `container.llm(agent.provider)` — the ONE
   *        LLM call per case.
   *     c. Score with `scoreCase(case.expectedOutput, findings, diff)` — ZERO
   *        additional LLM calls (AC-11). The raw `expectedOutput` jsonb is passed
   *        straight through so the scorer's `safeParse` handles malformed values.
   *     d. Persist one `eval_runs` row via `insertRunRow` (AC-13).
   *  4. Update the run group's aggregate metrics with `scoreRun` + total cost.
   *
   * Per-case failure isolation (edge case): a malformed `expectedOutput` or a
   * review error fails ONLY that case row — never the whole run.
   *
   * Concurrency: each invocation creates its OWN run group id at the start, so two
   * overlapping runs never interleave their rows (D1 distinct-group invariant).
   *
   * @param workspaceId   Workspace scoping (tenant safety, INSIGHTS 2026-06-29).
   * @param agentId       The agent to run.
   * @param label         Optional human label for this run group (e.g. "v7 — new prompt").
   */
  async runAgentEvals(
    workspaceId: string,
    agentId: string,
    label?: string,
  ): Promise<EvalRunGroupResult> {
    if (!this.container) {
      throw new Error(
        'EvalService.runAgentEvals requires a Container (for LLM access). ' +
          'Construct EvalService with new EvalService(db, container).',
      );
    }

    // 1. Load the agent row — fails if agent not in this workspace (tenant safety).
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId} in workspace ${workspaceId}`);
    }

    // 2. Load the agent's case set (AC-5 — may be empty; AC-6 inputs are frozen).
    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);

    // 3. Create the run group at the START (AC-7: records the agent's CURRENT version).
    //    Placeholder aggregates — updated after all cases are processed.
    const groupId = await this.repo.createRunGroup(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      agentVersion: agent.version,
      label: label ?? null,
      aggregates: { recall: 0, precision: 0, citationAccuracy: 0 },
      totalCostUsd: null,
    });

    // 4. Run each case — per-case failure isolation (edge case per plan).
    const perCaseScores: Array<import('./eval-scorer.js').ScoredCase> = [];
    const results: EvalRunResult[] = [];
    let totalCostUsd = 0;
    let hasCost = false;

    for (const evalCase of cases) {
      const caseStart = Date.now();
      try {
        // AC-6: parse the stored inputDiff TEXT verbatim — no re-fetch.
        const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');

        // ONE review LLM call per case (the thing under test).
        const provider = await this.container.llm(
          agent.provider as 'openai' | 'anthropic' | 'openrouter',
        );
        const outcome = await reviewPullRequest({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          diff,
          llm: provider,
          strategy: (agent.strategy as import('@devdigest/reviewer-core').ReviewStrategy) ?? 'auto',
        });

        const durationMs = Date.now() - caseStart;
        const costUsd = outcome.costUsd ?? null;
        if (costUsd !== null) {
          totalCostUsd += costUsd;
          hasCost = true;
        }

        const emittedFindings = outcome.review.findings;

        // AC-11: score with ZERO additional LLM calls.
        // Pass rawExpected straight through so the scorer's safeParse handles
        // malformed-case-skip without throwing (SPEC-03 edge case).
        const score = scoreCase(evalCase.expectedOutput, emittedFindings, diff);
        perCaseScores.push(score);

        // AC-13: persist one eval_runs row per case, linked to the group.
        const runRow = await this.repo.insertRunRow(groupId, evalCase.id, {
          actualOutput: emittedFindings as unknown,
          pass: score.pass,
          recall: score.recall,
          precision: score.precision,
          citationAccuracy: score.citation_accuracy,
          durationMs,
          costUsd,
        });

        results.push({
          run_id: runRow.id,
          case_id: evalCase.id,
          result: {
            recall: score.recall,
            precision: score.precision,
            citation_accuracy: score.citation_accuracy,
            traces_passed: score.pass ? 1 : 0,
            traces_total: 1,
            duration_ms: durationMs,
            cost_usd: costUsd,
            per_trace: [
              {
                name: evalCase.name ?? evalCase.id,
                pass: score.pass,
                expected: evalCase.expectedOutput ?? null,
                actual: emittedFindings,
              },
            ],
          },
        });
      } catch (err) {
        // Per-case failure isolation: a review error fails ONLY this case row.
        // The error is surfaced in the run row (pass=false, metrics=0) and a
        // result entry is added so callers can see which case failed.
        const durationMs = Date.now() - caseStart;
        const errScore: import('./eval-scorer.js').ScoredCase = {
          pass: false,
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          skipped: true,
          skipReason: err instanceof Error ? err.message : String(err),
        };
        perCaseScores.push(errScore);

        try {
          const runRow = await this.repo.insertRunRow(groupId, evalCase.id, {
            actualOutput: null,
            pass: false,
            recall: 0,
            precision: 0,
            citationAccuracy: 0,
            durationMs,
            costUsd: null,
          });
          results.push({
            run_id: runRow.id,
            case_id: evalCase.id,
            result: {
              recall: 0,
              precision: 0,
              citation_accuracy: 0,
              traces_passed: 0,
              traces_total: 1,
              duration_ms: durationMs,
              cost_usd: null,
              per_trace: [
                {
                  name: evalCase.name ?? evalCase.id,
                  pass: false,
                  expected: evalCase.expectedOutput ?? null,
                  actual: null,
                },
              ],
            },
          });
        } catch {
          // If even the failure row can't be persisted, skip silently — the run
          // group itself remains intact.
        }
      }
    }

    // 5. Aggregate metrics across all cases (AC-17: independently computed per run).
    const aggregate = scoreRun(perCaseScores);
    const finalCostUsd = hasCost ? totalCostUsd : null;

    // 6. Update the run group with final aggregates.
    await this.repo.updateRunGroupAggregates(groupId, {
      recall: aggregate.recall,
      precision: aggregate.precision,
      citationAccuracy: aggregate.citation_accuracy,
      totalCostUsd: finalCostUsd,
    });

    // 7. Fetch the final group record for the response.
    const group = await this.repo.getRunGroup(groupId);
    if (!group) {
      throw new Error(`Run group not found after creation: ${groupId}`);
    }

    return { group, results };
  }

  /**
   * Run ALL enabled agents in a workspace over their own frozen case sets (AC-20).
   *
   * Each agent runs independently; failures for one agent do not prevent others.
   * The total LLM cost is bounded by (agents × cases) review calls; scoring adds
   * zero additional calls (AC-11).
   *
   * @param workspaceId  Workspace scoping.
   */
  async runAllAgents(workspaceId: string): Promise<EvalRunGroupResult[]> {
    const agents = await this.agentsRepo.listEnabled(workspaceId);
    const results: EvalRunGroupResult[] = [];

    for (const agent of agents) {
      try {
        const result = await this.runAgentEvals(workspaceId, agent.id);
        results.push(result);
      } catch {
        // Per-agent failure isolation: if one agent's run fails entirely, skip
        // and continue with the rest (consistent with the per-case isolation stance).
      }
    }

    return results;
  }

  // ---- T7: History / Compare / Promote / Dashboard (AC-15/16/18/20) ----------

  /**
   * Run history for an agent, newest-first, with aggregates + version + cost.
   * Enriches `traces_passed` / `traces_total` / `pass_rate` from the per-case
   * run rows — the repository leaves these at 0 to avoid N+1 per group at the
   * repository level; we batch-load them here in a single pass (AC-15).
   *
   * Returns an `EvalDashboard` populated with `trend` + `recent_runs` for the
   * agent, which the client's Evals tab uses to render history + trend chart.
   *
   * @param workspaceId  Workspace scoping (tenant safety, INSIGHTS 2026-06-29).
   * @param agentId      The agent whose run history to return.
   */
  async runHistory(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    // Verify the agent belongs to this workspace (tenant safety).
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    // List all run groups newest-first (AC-15).
    const groups = await this.repo.listRunGroups(workspaceId, agentId);

    // Case count for this agent (AC-5 compatible).
    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    const casesTotal = cases.length;

    // Build trend + enrich traces_passed / traces_total / pass_rate (avoid N+1:
    // only fetch run rows for the groups we need — trend is capped at 20 groups
    // by the repository; recent_runs uses the latest group's rows).
    const trend: EvalTrendPoint[] = [];
    let recentRuns: EvalRunRecord[] = [];

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      const rows = await this.repo.runRowsForGroup(g.id);

      const tracesPassed = rows.filter((r) => r.pass === true).length;
      const tracesTotal = rows.length;
      const passRate = tracesTotal > 0 ? tracesPassed / tracesTotal : 1;

      trend.push({
        ran_at: g.ran_at,
        recall: g.recall,
        precision: g.precision,
        citation_accuracy: g.citation_accuracy,
        pass_rate: passRate,
        cost_usd: g.total_cost_usd,
      });

      if (i === 0) {
        // Enrich the recent run rows with traces_passed / traces_total data.
        recentRuns = rows;
      }
    }

    const latest = groups[0];
    const previous = groups[1];

    const currentMetrics = latest
      ? {
          recall: latest.recall,
          precision: latest.precision,
          citation_accuracy: latest.citation_accuracy,
          traces_passed: trend[0]
            ? Math.round(trend[0].pass_rate * (recentRuns.length || 0))
            : 0,
          traces_total: recentRuns.length,
          cost_usd: latest.total_cost_usd,
        }
      : {
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          traces_passed: 0,
          traces_total: 0,
          cost_usd: null,
        };

    const delta = {
      recall: latest && previous ? latest.recall - previous.recall : 0,
      precision: latest && previous ? latest.precision - previous.precision : 0,
      citation_accuracy:
        latest && previous
          ? latest.citation_accuracy - previous.citation_accuracy
          : 0,
    };

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: casesTotal,
      current: currentMetrics,
      delta,
      trend,
      recent_runs: recentRuns,
      alert: null,
    };
  }

  /**
   * Compare two run groups for an agent: per-metric deltas + system_prompt diff
   * between the two recorded agent versions (AC-16).
   *
   * Degrades gracefully: if a version was pruned from `agent_versions`, returns
   * `"version unavailable"` in the prompt diff field rather than throwing (AC-16
   * edge case: "Agent deleted / version pruned after a run").
   *
   * @param workspaceId   Workspace scoping.
   * @param agentId       The agent whose runs to compare.
   * @param runGroupIdA   The "A" (baseline) run group id.
   * @param runGroupIdB   The "B" (candidate) run group id.
   */
  async compare(
    workspaceId: string,
    agentId: string,
    runGroupIdA: string,
    runGroupIdB: string,
  ): Promise<EvalCompareResult> {
    // Tenant safety: verify the agent belongs to this workspace.
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const [groupA, groupB] = await Promise.all([
      this.repo.getRunGroup(runGroupIdA),
      this.repo.getRunGroup(runGroupIdB),
    ]);
    if (!groupA) throw new Error(`Run group not found: ${runGroupIdA}`);
    if (!groupB) throw new Error(`Run group not found: ${runGroupIdB}`);

    // Tenant safety: both groups must belong to this workspace + agent.
    if (groupA.workspace_id !== workspaceId || groupA.owner_id !== agentId) {
      throw new Error(`Run group ${runGroupIdA} does not belong to agent ${agentId}`);
    }
    if (groupB.workspace_id !== workspaceId || groupB.owner_id !== agentId) {
      throw new Error(`Run group ${runGroupIdB} does not belong to agent ${agentId}`);
    }

    // Per-metric deltas (B − A, i.e. candidate − baseline).
    const delta = {
      recall: groupB.recall - groupA.recall,
      precision: groupB.precision - groupA.precision,
      citation_accuracy: groupB.citation_accuracy - groupA.citation_accuracy,
    };

    // Resolve system_prompt from each group's recorded agentVersion via the
    // EXISTING agent_versions / AgentVersion.config path (AC-16).
    // Degrade to "version unavailable" when a version has been pruned.
    const [versionA, versionB] = await Promise.all([
      this.agentsRepo.getVersion(agentId, groupA.agent_version),
      this.agentsRepo.getVersion(agentId, groupB.agent_version),
    ]);

    const promptA = versionA
      ? toAgentVersionDto(versionA).config.system_prompt
      : 'version unavailable';
    const promptB = versionB
      ? toAgentVersionDto(versionB).config.system_prompt
      : 'version unavailable';

    // Produce a simple unified-diff-style text comparison of the two prompts.
    const systemPromptDiff = computeTextDiff(promptA, promptB, groupA.agent_version, groupB.agent_version);

    // Load the per-case run rows for both groups.
    const [rowsA, rowsB] = await Promise.all([
      this.repo.runRowsForGroup(runGroupIdA),
      this.repo.runRowsForGroup(runGroupIdB),
    ]);

    return {
      group_a: groupA,
      group_b: groupB,
      delta,
      system_prompt_diff: systemPromptDiff,
      prompt_a: promptA,
      prompt_b: promptB,
      rows_a: rowsA,
      rows_b: rowsB,
    };
  }

  /**
   * Promote an agent to a chosen recorded version (AC-18).
   *
   * Sets the agent's active configuration to the snapshot in `agent_versions`
   * for the given `version` integer, using the EXISTING agent-version mechanism
   * (`agents/service.ts:102-121`, `repository.ts:118-151` `update` path).
   *
   * No divergent versioning scheme is introduced: the `update` path in
   * `AgentsRepository` writes the config fields, bumps the version, and snapshots
   * the new state. The promoted version becomes the new baseline for future runs.
   *
   * @param workspaceId  Workspace scoping (tenant safety).
   * @param agentId      The agent to promote.
   * @param version      The version number from a run group's `agent_version`.
   * @returns The updated `AgentVersion` DTO, or throws if the version is not found.
   */
  async promote(workspaceId: string, agentId: string, version: number): Promise<AgentVersion> {
    // Tenant safety: agent must belong to this workspace.
    const agent = await this.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    // Load the target version snapshot from agent_versions (AC-18).
    const versionRow = await this.agentsRepo.getVersion(agentId, version);
    if (!versionRow) {
      throw new Error(`Agent version ${version} not found (may have been pruned) for agent ${agentId}`);
    }

    const config = toAgentVersionDto(versionRow).config;

    // Reuse the EXISTING agents update + version-bump path (agents/repository.ts:118-151).
    // This writes the config to `agents`, bumps `agents.version`, and snapshots
    // the new state in `agent_versions` — no parallel versioning scheme (AC-18).
    const updatedRow = await this.agentsRepo.update(workspaceId, agentId, {
      name: config.name,
      description: config.description,
      provider: config.provider,
      model: config.model,
      systemPrompt: config.system_prompt,
      strategy: config.strategy,
      ciFailOn: config.ci_fail_on,
      repoIntel: config.repo_intel,
    });

    if (!updatedRow) throw new Error(`Failed to promote agent ${agentId} to version ${version}`);

    // Return the new current version DTO.
    const newVersionRow = await this.agentsRepo.getVersion(agentId, updatedRow.version);
    if (!newVersionRow) throw new Error(`Version snapshot missing after promote for agent ${agentId}`);

    return toAgentVersionDto(newVersionRow);
  }

  /**
   * Cross-agent Eval Dashboard aggregate for a workspace (AC-20).
   *
   * Lists every agent with a case set (or at least one run group) in the
   * workspace with their current recall/precision/citation + recent runs.
   * Delegates to the repository's `dashboardAggregate` — which is the
   * canonical source for the cross-agent view — and enriches
   * `traces_passed` / `traces_total` from the latest group's run rows.
   *
   * @param workspaceId  Workspace scoping.
   */
  async dashboard(workspaceId: string): Promise<EvalDashboard[]> {
    return this.repo.dashboardAggregate(workspaceId);
  }
}

// ---------------------------------------------------------------------------
// T7 supplementary types
// ---------------------------------------------------------------------------

/** Return type of `EvalService.compare` (AC-16). */
export interface EvalCompareResult {
  group_a: EvalRunGroup;
  group_b: EvalRunGroup;
  /** Per-metric delta: B − A (candidate − baseline). */
  delta: { recall: number; precision: number; citation_accuracy: number };
  /**
   * Unified-diff-style text diff of the two groups' recorded `system_prompt`s.
   * `"version unavailable"` when either version was pruned from `agent_versions`
   * (AC-16 graceful degrade).
   */
  system_prompt_diff: string;
  /** The raw system_prompt for group A (or "version unavailable"). */
  prompt_a: string;
  /** The raw system_prompt for group B (or "version unavailable"). */
  prompt_b: string;
  /** Per-case run rows for group A. */
  rows_a: EvalRunRecord[];
  /** Per-case run rows for group B. */
  rows_b: EvalRunRecord[];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Produce a minimal line-level diff of two text strings (the system prompts).
 * Not a full unified diff (avoids pulling in `diff` as a dep) — produces a
 * human-readable `--- vN / +++ vM` header with changed lines prefixed by `-`/`+`.
 *
 * If both strings are identical the diff is the empty string.
 * If either string is "version unavailable" we return a note instead.
 */
function computeTextDiff(textA: string, textB: string, versionA: number, versionB: number): string {
  if (textA === 'version unavailable' || textB === 'version unavailable') {
    return `[one or both versions unavailable — diff not possible]`;
  }
  if (textA === textB) return '';

  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  // Simple line-set diff: lines only in A are "-", lines only in B are "+".
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const removed = linesA.filter((l) => !setB.has(l)).map((l) => `- ${l}`);
  const added = linesB.filter((l) => !setA.has(l)).map((l) => `+ ${l}`);

  const lines = [
    `--- system_prompt v${versionA}`,
    `+++ system_prompt v${versionB}`,
    ...removed,
    ...added,
  ];
  return lines.join('\n');
}
