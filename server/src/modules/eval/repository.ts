import { and, asc, count, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ConfigError } from '../../platform/errors.js';

/** Per-agent summary row for the cross-agent eval dashboard (Step 4, AC-3). */
export interface EvalConfiguredAgentSummaryRow {
  agentId: string;
  agentName: string;
  model: string;
  latestBatch: EvalBatchRow | null;
  /** PROMPT version of the latest full batch — bumps only when the agent's
   *  system-prompt text changes (unchanged-prompt reruns share one version),
   *  NOT a run count. Null when the latest full batch has no snapshot (predates
   *  prompt tracking) or the agent has no sealed full batch yet. Derived. */
  latestVersion: number | null;
  caseCount: number;
}

/** One row in the cross-agent "recent batches" feed (Step 4, AC-9). */
export interface RecentBatchAcrossAgentsRow {
  batch: EvalBatchRow;
  agentId: string;
  agentName: string;
  /** PROMPT version of this batch — bumps only when the agent's system-prompt
   *  text changes (unchanged-prompt reruns share one version), NOT a run
   *  ordinal. Null when the batch has no snapshot (predates prompt tracking). */
  version: number | null;
  passCount: number;
  totalCount: number;
}

// Row shapes (Drizzle's inferred select/insert types for the eval tables).
type EvalCaseRow = typeof t.evalCases.$inferSelect;
type EvalCaseInsert = typeof t.evalCases.$inferInsert;
type EvalBatchRow = typeof t.evalBatches.$inferSelect;
type EvalBatchInsert = typeof t.evalBatches.$inferInsert;
type EvalRunRow = typeof t.evalRuns.$inferSelect;
type EvalRunInsert = typeof t.evalRuns.$inferInsert;

/**
 * EvalRepository — infrastructure-only DB access for eval cases, batches, and
 * runs (L06). Every method is workspace-scoped: either directly (eval_batches
 * has its own workspace_id column) or transitively (eval_runs has none of its
 * own — scope flows through eval_cases.workspace_id or eval_batches.workspace_id).
 *
 * No business rules here (e.g. "flaked" detection, degraded-status derivation)
 * — those live in the eval service.
 */
export class EvalRepository {
  constructor(private db: Db) {}

  // -------------------------------------------------------------- eval_cases

  /** Agent-owned eval cases for the given agent, workspace-scoped. */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      );
  }

  /** Count of skill-owned cases in the workspace (feeds the visible-exclusion count). */
  async countSkillOwnedCases(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ cnt: count() })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'skill')));
    return rows[0]?.cnt ?? 0;
  }

  /** A single eval case row, or null if it doesn't exist / isn't in this workspace. */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert a new eval case; returns the inserted row. */
  async insertCase(data: EvalCaseInsert): Promise<EvalCaseRow> {
    const [row] = await this.db.insert(t.evalCases).values(data).returning();
    if (!row) throw new ConfigError('insertCase: insert returned no row');
    return row;
  }

  /**
   * Full-replacement update of an eval case's editable fields (name, diff,
   * expectations, notes), workspace-scoped. Does NOT touch `ownerKind`/
   * `ownerId`/`inputMeta` — provenance is preserved by the caller (service
   * layer never passes those fields here). Returns the updated row, or null
   * if the case doesn't exist / isn't in this workspace.
   */
  async updateCase(
    workspaceId: string,
    caseId: string,
    data: { name: string; inputDiff: string; expectedOutput: unknown; notes: string | null },
  ): Promise<EvalCaseRow | null> {
    const rows = await this.db
      .update(t.evalCases)
      .set({
        name: data.name,
        inputDiff: data.inputDiff,
        expectedOutput: data.expectedOutput,
        notes: data.notes,
      })
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning();
    return rows[0] ?? null;
  }

  /** Delete an eval case, workspace-scoped. Returns true if a row was deleted. */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.id, caseId), eq(t.evalCases.workspaceId, workspaceId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // --------------------------------------------------------------- eval_runs

  /**
   * Most recent eval_runs row for a case (feeds last_run_status /
   * last_run_summary). eval_runs has no workspace_id of its own; scope is
   * transitive via eval_cases — callers must have already resolved/verified
   * the case in the workspace (e.g. via `getCase(workspaceId, caseId)`)
   * before calling this, per the plan's specified signature.
   */
  async latestRunForCase(caseId: string): Promise<EvalRunRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, caseId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Raw pass/fail/error outcomes (newest first, max 3) for a case across its
   * last three FULL batches only. Feeds the service-layer "flaked" decision —
   * this method returns the raw sequence, no interpretation.
   */
  async lastThreeFullBatchOutcomesForCase(
    caseId: string,
    agentId: string,
  ): Promise<('passed' | 'failed' | 'error')[]> {
    const rows = await this.db
      .select({ pass: t.evalRuns.pass })
      .from(t.evalRuns)
      .innerJoin(t.evalBatches, eq(t.evalRuns.batchId, t.evalBatches.id))
      .where(
        and(
          eq(t.evalRuns.caseId, caseId),
          eq(t.evalBatches.agentId, agentId),
          eq(t.evalBatches.kind, 'full'),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(3);

    return rows.map((r) => outcomeFromPass(r.pass));
  }

  /** Insert a new eval_runs row (includes the nullable batch_id); returns it. */
  async insertRun(data: EvalRunInsert): Promise<EvalRunRow> {
    const [row] = await this.db.insert(t.evalRuns).values(data).returning();
    if (!row) throw new ConfigError('insertRun: insert returned no row');
    return row;
  }

  /** Per-case eval_runs rows belonging to a batch (for a batch detail view). */
  async runsForBatch(batchId: string): Promise<EvalRunRow[]> {
    return this.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
  }

  // ------------------------------------------------------------ eval_batches

  /** Insert a new eval_batches row; returns the inserted row. */
  async insertBatch(data: EvalBatchInsert): Promise<EvalBatchRow> {
    const [row] = await this.db.insert(t.evalBatches).values(data).returning();
    if (!row) throw new ConfigError('insertBatch: insert returned no row');
    return row;
  }

  /** Update the aggregate metrics on a batch once all its case-runs complete. */
  async updateBatchAggregate(
    batchId: string,
    metrics: {
      recall: number | null;
      precision: number | null;
      citationAccuracy: number | null;
      costUsd: number | null;
      status: 'clean' | 'degraded' | null;
    },
  ): Promise<void> {
    await this.db
      .update(t.evalBatches)
      .set({
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citationAccuracy,
        costUsd: metrics.costUsd,
        status: metrics.status,
      })
      .where(eq(t.evalBatches.id, batchId));
  }

  /** All batches for an agent, newest first (AC-33). */
  async listBatchHistory(workspaceId: string, agentId: string): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.agentId, agentId)))
      .orderBy(desc(t.evalBatches.ranAt));
  }

  /**
   * 'full'-kind batches only for an agent, newest first (AC-28 trend chart).
   * `status IS NOT NULL` excludes unsealed batches (#5) — a batch row is
   * inserted with `status: null` BEFORE its cases run (run-orchestrator's
   * `startBatch`), so an in-flight or crash-orphaned full batch would
   * otherwise plot as a false clean 0%/0%/0% dip. `desc(id)` is a secondary
   * sort key (N2) so two batches sharing an identical `ran_at` instant order
   * deterministically.
   */
  async listTrendBatches(workspaceId: string, agentId: string): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.workspaceId, workspaceId),
          eq(t.evalBatches.agentId, agentId),
          eq(t.evalBatches.kind, 'full'),
          isNotNull(t.evalBatches.status),
        ),
      )
      .orderBy(desc(t.evalBatches.ranAt), desc(t.evalBatches.id));
  }

  /** A single batch row, or null (AC-32). */
  async getBatch(workspaceId: string, batchId: string): Promise<EvalBatchRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.id, batchId), eq(t.evalBatches.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The most recent 'full'-kind batch that ran strictly before `beforeRanAt`
   * (AC-31's skip-calibration delta baseline). `status IS NOT NULL` excludes
   * unsealed batches (#5) — an in-flight/crashed full batch must never be
   * used as a KPI-delta baseline. `desc(id)` is a secondary sort key (N2)
   * so a tied `ran_at` can't cause the strict `<` to skip a true predecessor
   * nondeterministically.
   */
  async previousFullBatch(
    workspaceId: string,
    agentId: string,
    beforeRanAt: Date,
  ): Promise<EvalBatchRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.workspaceId, workspaceId),
          eq(t.evalBatches.agentId, agentId),
          eq(t.evalBatches.kind, 'full'),
          isNotNull(t.evalBatches.status),
          lt(t.evalBatches.ranAt, beforeRanAt),
        ),
      )
      .orderBy(desc(t.evalBatches.ranAt), desc(t.evalBatches.id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ----------------------------------------------- cross-agent eval dashboard

  /**
   * Per-agent summary for every agent in the workspace that has ≥1 agent-owned
   * eval case (AC-3): the agent's id/name/model, its latest SEALED full batch
   * (or null if it has cases but has never completed a full run), and its
   * case_count. Mirrors `listTrendBatches`/`previousFullBatch`'s filter
   * conventions (`kind='full' AND status IS NOT NULL`) for "latest batch".
   *
   * Sparkline points are intentionally a SEPARATE, later query
   * (`recentTrendPointsForAgents`) capped to a small N — this method never
   * fetches full trend history for the dashboard card.
   */
  async listEvalConfiguredAgentSummaries(workspaceId: string): Promise<EvalConfiguredAgentSummaryRow[]> {
    const caseCounts = await this.db
      .select({
        agentId: t.evalCases.ownerId,
        caseCount: sql<number>`count(*)::int`,
      })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);

    if (caseCounts.length === 0) return [];

    const agentIds = caseCounts.map((c) => c.agentId);

    const agentRows = await this.db
      .select({ id: t.agents.id, name: t.agents.name, model: t.agents.model })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agentIds)))
      // Deterministic dashboard grid order: without an ORDER BY these rows
      // come back in whatever order Postgres happens to return them, which
      // is not guaranteed stable across requests. Sort by name ascending —
      // user-friendly and stable.
      .orderBy(asc(t.agents.name));

    // Latest sealed full batch per qualifying agent — one query, filtered to
    // the qualifying agent id set, then reduced client-side to the newest row
    // per agent (same tie-break as listTrendBatches: desc(ran_at), desc(id)).
    const batchRows = await this.db
      .select()
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.workspaceId, workspaceId),
          inArray(t.evalBatches.agentId, agentIds),
          eq(t.evalBatches.kind, 'full'),
          isNotNull(t.evalBatches.status),
        ),
      )
      .orderBy(desc(t.evalBatches.ranAt), desc(t.evalBatches.id));

    const latestBatchByAgent = new Map<string, EvalBatchRow>();
    for (const row of batchRows) {
      if (!latestBatchByAgent.has(row.agentId)) latestBatchByAgent.set(row.agentId, row);
    }

    // PROMPT version per batch (folded over the fetched sealed full batches, per
    // agent) — so `latestVersion` reflects the prompt lineage (v1 for the first
    // distinct prompt, bumping only when the prompt text changes), NOT a run
    // count. A latest batch with no snapshot yields a null version.
    const promptVersionByBatch = promptVersionsByAgent(
      batchRows.map((r) => ({ id: r.id, agentId: r.agentId, ranAt: r.ranAt, systemPromptSnapshot: r.systemPromptSnapshot })),
    );

    const caseCountByAgent = new Map(caseCounts.map((c) => [c.agentId, c.caseCount]));

    return agentRows.map((agent) => {
      const latestBatch = latestBatchByAgent.get(agent.id) ?? null;
      return {
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        latestBatch,
        latestVersion: latestBatch ? promptVersionByBatch.get(latestBatch.id) ?? null : null,
        caseCount: caseCountByAgent.get(agent.id) ?? 0,
      };
    });
  }

  /**
   * Recent sealed full batches for ONE agent, newest first, capped to `limit`
   * (small — feeds a dashboard-card sparkline, not the full trend chart).
   * Same `kind='full' AND status IS NOT NULL` filter as `listTrendBatches`.
   */
  async recentTrendPointsForAgent(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.workspaceId, workspaceId),
          eq(t.evalBatches.agentId, agentId),
          eq(t.evalBatches.kind, 'full'),
          isNotNull(t.evalBatches.status),
        ),
      )
      .orderBy(desc(t.evalBatches.ranAt), desc(t.evalBatches.id))
      .limit(limit);
  }

  /**
   * Recent FULL batches across ALL agents in the workspace, newest first,
   * capped at `limit` (server-fixed cap — never unbounded, AC-9). Calibration
   * (subset) batches are excluded from the cross-agent feed.
   *
   * Three queries: (1) the capped recent window (batch + agent name); (2) the
   * full-batch snapshot history for the agents in that window, folded into a
   * PROMPT version per batch (`promptVersionsByAgent`) — the window alone can't
   * compute it because a batch's prompt version depends on its agent's ENTIRE
   * snapshot lineage, not just the recent slice; (3) `pass_count`/`total_count`
   * aggregated from `eval_runs` grouped by `batch_id`. All three stay bounded:
   * the window is capped, and the history/pass-count fetches are scoped to the
   * window's (few) agents / (≤limit) batch ids.
   */
  async listRecentBatchesAcrossAgents(
    workspaceId: string,
    limit: number,
  ): Promise<RecentBatchAcrossAgentsRow[]> {
    const rows = await this.db
      .select({
        batch: t.evalBatches,
        agentName: t.agents.name,
      })
      .from(t.evalBatches)
      .innerJoin(t.agents, eq(t.evalBatches.agentId, t.agents.id))
      // Dashboard shows real test attempts only — calibration (subset) batches
      // are excluded from the cross-agent feed and from version numbering.
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.kind, 'full')))
      .orderBy(desc(t.evalBatches.ranAt), desc(t.evalBatches.id))
      .limit(limit);

    if (rows.length === 0) return [];

    // PROMPT version depends on the agent's ENTIRE full-batch snapshot history,
    // not just this capped window — so fetch the (lightweight) full-batch
    // snapshot history for the agents present in the window and fold it,
    // mirroring the client `promptVersionMap`. A batch with no snapshot
    // (predates tracking) gets a null version.
    const windowAgentIds = [...new Set(rows.map((r) => r.batch.agentId))];
    const historyRows = await this.db
      .select({
        id: t.evalBatches.id,
        agentId: t.evalBatches.agentId,
        ranAt: t.evalBatches.ranAt,
        systemPromptSnapshot: t.evalBatches.systemPromptSnapshot,
      })
      .from(t.evalBatches)
      .where(
        and(
          eq(t.evalBatches.workspaceId, workspaceId),
          inArray(t.evalBatches.agentId, windowAgentIds),
          eq(t.evalBatches.kind, 'full'),
        ),
      );
    const promptVersionByBatch = promptVersionsByAgent(historyRows);

    const batchIds = rows.map((r) => r.batch.id);
    const passCountRows = await this.db
      .select({
        batchId: t.evalRuns.batchId,
        passCount: sql<number>`count(*) filter (where ${t.evalRuns.pass} = true)::int`,
        totalCount: sql<number>`count(*)::int`,
      })
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.batchId, batchIds))
      .groupBy(t.evalRuns.batchId);

    const passCountByBatch = new Map(
      passCountRows.filter((r) => r.batchId != null).map((r) => [r.batchId as string, r]),
    );

    return rows.map((r) => {
      const counts = passCountByBatch.get(r.batch.id);
      return {
        batch: r.batch,
        agentId: r.batch.agentId,
        agentName: r.agentName,
        version: promptVersionByBatch.get(r.batch.id) ?? null,
        passCount: counts?.passCount ?? 0,
        totalCount: counts?.totalCount ?? 0,
      };
    });
  }

  /**
   * A batch's owning agent id + frozen prompt snapshot, workspace-scoped —
   * the ONE method `container.evalRepo` exposes outside the `eval` module
   * (used by `agents/service.ts`'s promote flow to read the snapshot without
   * importing `eval/repository.js` directly, R6).
   */
  async getBatchPromptSnapshot(
    workspaceId: string,
    batchId: string,
  ): Promise<{ agentId: string; systemPromptSnapshot: string | null } | null> {
    const rows = await this.db
      .select({ agentId: t.evalBatches.agentId, systemPromptSnapshot: t.evalBatches.systemPromptSnapshot })
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.id, batchId), eq(t.evalBatches.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * The eval case previously created from this exact finding, if any (#12 —
   * idempotency guard for `createCaseFromFinding`). `input_meta` is JSONB;
   * `->>'source_finding_id'` extracts the text value for comparison.
   */
  async findCaseBySourceFindingId(workspaceId: string, findingId: string): Promise<EvalCaseRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          sql`${t.evalCases.inputMeta} ->> 'source_finding_id' = ${findingId}`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Clear ALL run history (eval_batches + eval_runs) for one agent, workspace-
   * scoped, in a SINGLE transaction — eval_cases (the case definitions) are
   * NEVER touched, only their run history. `eval_runs.batch_id → eval_batches`
   * is `ON DELETE SET NULL` (schema/eval.ts), so deleting batches alone would
   * NOT remove the agent's runs — they must be deleted explicitly via the
   * `eval_cases.id` subquery (eval_runs has no workspace_id/agent_id of its
   * own; scope flows transitively through eval_cases.owner_id/owner_kind).
   * Runs deleted first, then batches, inside one transaction so a mid-way
   * failure leaves neither partially cleared.
   */
  async clearHistory(
    workspaceId: string,
    agentId: string,
  ): Promise<{ deletedBatches: number; deletedRuns: number }> {
    return this.db.transaction(async (tx) => {
      const deletedRuns = await tx
        .delete(t.evalRuns)
        .where(
          inArray(
            t.evalRuns.caseId,
            tx
              .select({ id: t.evalCases.id })
              .from(t.evalCases)
              .where(
                and(
                  eq(t.evalCases.workspaceId, workspaceId),
                  eq(t.evalCases.ownerId, agentId),
                  eq(t.evalCases.ownerKind, 'agent'),
                ),
              ),
          ),
        )
        .returning({ id: t.evalRuns.id });

      const deletedBatches = await tx
        .delete(t.evalBatches)
        .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.agentId, agentId)))
        .returning({ id: t.evalBatches.id });

      return { deletedBatches: deletedBatches.length, deletedRuns: deletedRuns.length };
    });
  }
}

function outcomeFromPass(pass: boolean | null): 'passed' | 'failed' | 'error' {
  if (pass === null) return 'error';
  return pass ? 'passed' : 'failed';
}

/** Minimal batch shape the prompt-version fold needs. */
interface PromptVersionInput {
  id: string;
  agentId: string;
  ranAt: Date;
  systemPromptSnapshot: string | null;
}

/**
 * Fold `batchId → PROMPT version`, grouped by agent — the server-side mirror of
 * the client `promptVersionMap`. Per agent, over batches WITH a non-null
 * snapshot in chronological order (ran_at asc, id asc), the version bumps only
 * when the snapshot text differs from the previous non-null snapshot; batches
 * without a snapshot are absent from the map (their prompt version is unknown,
 * not 0). Tie-break by id matches the client so server- and client-derived
 * numbers agree when two batches share a `ran_at`.
 */
function promptVersionsByAgent(batches: PromptVersionInput[]): Map<string, number> {
  const byAgent = new Map<string, PromptVersionInput[]>();
  for (const b of batches) {
    const arr = byAgent.get(b.agentId);
    if (arr) arr.push(b);
    else byAgent.set(b.agentId, [b]);
  }

  const versions = new Map<string, number>();
  for (const agentBatches of byAgent.values()) {
    const chronological = agentBatches
      .filter((b) => b.systemPromptSnapshot != null)
      .sort((a, b) => {
        const t = a.ranAt.getTime() - b.ranAt.getTime();
        return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    let version = 0;
    let prev: string | null = null;
    for (const b of chronological) {
      const snap = b.systemPromptSnapshot as string;
      if (snap !== prev) version += 1;
      versions.set(b.id, version);
      prev = snap;
    }
  }
  return versions;
}
