import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalCaseInput,
  EvalRunRecord,
  EvalTrendPoint,
  EvalDashboard,
  EvalRunGroup,
} from '@devdigest/shared';

/**
 * A4 — Eval repository (Ring 3).
 *
 * All eval DB I/O: case CRUD, run-group insert + per-case eval_runs insert,
 * and dashboard / history reads. Every read/write is workspace-scoped
 * (eval_cases.workspaceId, tenant safety — INSIGHTS 2026-06-29).
 *
 * Enriched/derived fields on returned shapes use `.nullish()` convention
 * (INSIGHTS 2026-06-20, trace.ts:94-114 pattern).
 */

// ---------------------------------------------------------------------------
// Row-level types inferred from the Drizzle schema
// ---------------------------------------------------------------------------

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type EvalRunGroupRow = typeof t.evalRunGroups.$inferSelect;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface InsertCase {
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertRunGroupInput {
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  /** The agent's `agents.version` at the time of the run (AC-7). */
  agentVersion: number;
  label?: string | null;
  /** Aggregate metrics across all cases. */
  aggregates: {
    recall: number;
    precision: number;
    citationAccuracy: number;
  };
  totalCostUsd?: number | null;
}

export interface InsertRunRowInput {
  actualOutput?: unknown;
  pass?: boolean;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

// ---------------------------------------------------------------------------
// EvalRepository
// ---------------------------------------------------------------------------

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- Case CRUD -----------------------------------------------------------

  /**
   * Create an eval case scoped to `workspaceId` (AC-5 tenant safety).
   * Accepts both the API contract shape and the internal insert shape.
   */
  async createCase(workspaceId: string, input: EvalCaseInput | InsertCase): Promise<EvalCaseRow> {
    // Normalise from EvalCaseInput (snake_case) or InsertCase (camelCase).
    const isApiInput = 'owner_kind' in input;
    const values = {
      workspaceId,
      ownerKind: (isApiInput ? (input as EvalCaseInput).owner_kind : (input as InsertCase).ownerKind) as
        | 'skill'
        | 'agent',
      ownerId: isApiInput
        ? (input as EvalCaseInput).owner_id
        : (input as InsertCase).ownerId,
      name: input.name,
      inputDiff: isApiInput
        ? ((input as EvalCaseInput).input_diff ?? '')
        : ((input as InsertCase).inputDiff ?? ''),
      inputFiles: (isApiInput
        ? (input as EvalCaseInput).input_files
        : (input as InsertCase).inputFiles) as object | undefined,
      inputMeta: (isApiInput
        ? (input as EvalCaseInput).input_meta
        : (input as InsertCase).inputMeta) as object | undefined,
      expectedOutput: (isApiInput
        ? (input as EvalCaseInput).expected_output
        : (input as InsertCase).expectedOutput) as object | undefined,
      notes: isApiInput
        ? ((input as EvalCaseInput).notes ?? null)
        : ((input as InsertCase).notes ?? null),
    };

    const [row] = await this.db.insert(t.evalCases).values(values).returning();
    return row!;
  }

  /**
   * List all eval cases for a given owner, workspace-scoped (AC-5).
   * Supports ≥8 cases; no upper limit.
   */
  async listCases(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /** Fetch a single eval case, workspace-scoped (tenant safety). */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)),
      );
    return row;
  }

  /** Delete an eval case, workspace-scoped. Returns false if not found. */
  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)),
      )
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- Run groups ----------------------------------------------------------

  /**
   * Create a run group for an agent run (AC-7, AC-13).
   * Records the agent's current version at creation time.
   * Returns the new group id.
   */
  async createRunGroup(workspaceId: string, input: InsertRunGroupInput): Promise<string> {
    const [row] = await this.db
      .insert(t.evalRunGroups)
      .values({
        workspaceId,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        agentVersion: input.agentVersion,
        label: input.label ?? null,
        recall: input.aggregates.recall,
        precision: input.aggregates.precision,
        citationAccuracy: input.aggregates.citationAccuracy,
        totalCostUsd: input.totalCostUsd ?? null,
      })
      .returning({ id: t.evalRunGroups.id });
    return row!.id;
  }

  /**
   * Update aggregate metrics on a run group (called after all case rows are
   * inserted, once the final aggregates are computed).
   */
  async updateRunGroupAggregates(
    runGroupId: string,
    aggregates: {
      recall: number;
      precision: number;
      citationAccuracy: number;
      totalCostUsd?: number | null;
    },
  ): Promise<void> {
    await this.db
      .update(t.evalRunGroups)
      .set({
        recall: aggregates.recall,
        precision: aggregates.precision,
        citationAccuracy: aggregates.citationAccuracy,
        totalCostUsd: aggregates.totalCostUsd ?? null,
      })
      .where(eq(t.evalRunGroups.id, runGroupId));
  }

  /**
   * Insert one `eval_runs` row for a case run (AC-13).
   * Associates the row with its run group via `run_group_id` (D1 FK).
   */
  async insertRunRow(
    runGroupId: string,
    caseId: string,
    input: InsertRunRowInput,
  ): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId,
        runGroupId,
        actualOutput: (input.actualOutput as object | undefined) ?? null,
        pass: input.pass ?? null,
        recall: input.recall ?? null,
        precision: input.precision ?? null,
        citationAccuracy: input.citationAccuracy ?? null,
        durationMs: input.durationMs ?? null,
        costUsd: input.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  // ---- History reads -------------------------------------------------------

  /**
   * List run groups for an owner, newest-first (AC-15).
   * Returns `EvalRunGroup`-shaped records.
   */
  async listRunGroups(workspaceId: string, ownerId: string): Promise<EvalRunGroup[]> {
    const rows = await this.db
      .select()
      .from(t.evalRunGroups)
      .where(
        and(
          eq(t.evalRunGroups.workspaceId, workspaceId),
          eq(t.evalRunGroups.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRunGroups.ranAt));

    return rows.map(rowToRunGroup);
  }

  /**
   * Fetch a single run group by id, workspace-scoped (defence-in-depth,
   * mirrors `getCase` — REPO-001). Pass `workspaceId` to prevent cross-tenant
   * group reads even if the caller has the raw id (e.g. from a compare request).
   * Omitting `workspaceId` (leaving it `undefined`) skips the tenant filter and
   * is reserved for internal-only callers that already hold a group id they
   * created; all request-driven callers MUST pass a real `workspaceId`.
   */
  async getRunGroup(id: string, workspaceId?: string): Promise<EvalRunGroup | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunGroups)
      .where(
        workspaceId
          ? and(eq(t.evalRunGroups.workspaceId, workspaceId), eq(t.evalRunGroups.id, id))
          : eq(t.evalRunGroups.id, id),
      );
    return row ? rowToRunGroup(row) : undefined;
  }

  /**
   * Fetch all per-case run rows for a run group (AC-16 Compare).
   * Returns `EvalRunRecord`-shaped records (enriched with nullable case_name).
   */
  async runRowsForGroup(runGroupId: string): Promise<EvalRunRecord[]> {
    const rows = await this.db
      .select({
        run: t.evalRuns,
        caseName: t.evalCases.name,
      })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.runGroupId, runGroupId));

    return rows.map((r) => rowToRunRecord(r.run, r.caseName ?? null));
  }

  /**
   * Batch variant of `runRowsForGroup` (AC-15) — fetch per-case rows for MANY
   * run groups in a SINGLE query and bucket them by `run_group_id`, avoiding the
   * N+1 that a per-group loop would incur when building run history. Groups with
   * no rows are simply absent from the returned map. Callers pass ids already
   * resolved from a workspace-scoped `listRunGroups`, so the ids are tenant-safe.
   */
  async runRowsForGroups(runGroupIds: string[]): Promise<Map<string, EvalRunRecord[]>> {
    const out = new Map<string, EvalRunRecord[]>();
    if (runGroupIds.length === 0) return out;

    const rows = await this.db
      .select({
        run: t.evalRuns,
        caseName: t.evalCases.name,
      })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(inArray(t.evalRuns.runGroupId, runGroupIds));

    for (const r of rows) {
      const key = r.run.runGroupId;
      if (!key) continue;
      const rec = rowToRunRecord(r.run, r.caseName ?? null);
      const bucket = out.get(key);
      if (bucket) bucket.push(rec);
      else out.set(key, [rec]);
    }
    return out;
  }

  // ---- Dashboard aggregate -------------------------------------------------

  /**
   * Cross-agent dashboard aggregate for a workspace (AC-20).
   *
   * Returns one `EvalDashboard` per agent that has at least one case or run
   * group in the workspace. Groups are ordered newest-first; trend = last 20
   * groups; recent_runs = the per-case rows of the latest group.
   *
   * Delta = (latest group metrics) − (second-latest group metrics). If only
   * one group exists the delta is 0. Enriched/derived fields are `.nullish()`
   * per the INSIGHTS 2026-06-20 pattern.
   */
  async dashboardAggregate(workspaceId: string): Promise<EvalDashboard[]> {
    // 1. All distinct agent owners with cases in this workspace.
    const ownerRows = await this.db
      .selectDistinct({ ownerKind: t.evalCases.ownerKind, ownerId: t.evalCases.ownerId })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));

    const results: EvalDashboard[] = [];

    for (const { ownerKind, ownerId } of ownerRows) {
      // Count cases for this owner.
      const [caseCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(t.evalCases)
        .where(
          and(
            eq(t.evalCases.workspaceId, workspaceId),
            eq(t.evalCases.ownerKind, ownerKind),
            eq(t.evalCases.ownerId, ownerId),
          ),
        );
      const casesTotal = caseCount?.count ?? 0;

      // Run groups, newest-first; limit 20 for trend.
      const groups = await this.db
        .select()
        .from(t.evalRunGroups)
        .where(
          and(
            eq(t.evalRunGroups.workspaceId, workspaceId),
            eq(t.evalRunGroups.ownerId, ownerId),
          ),
        )
        .orderBy(desc(t.evalRunGroups.ranAt))
        .limit(20);

      const trend: EvalTrendPoint[] = groups.map((g) => ({
        ran_at: g.ranAt.toISOString(),
        recall: g.recall ?? 0,
        precision: g.precision ?? 0,
        citation_accuracy: g.citationAccuracy ?? 0,
        pass_rate: 0, // Derived below per group via run rows if needed.
        cost_usd: g.totalCostUsd ?? null,
      }));

      const latest = groups[0];
      const previous = groups[1];

      const currentMetrics = latest
        ? {
            recall: latest.recall ?? 0,
            precision: latest.precision ?? 0,
            citation_accuracy: latest.citationAccuracy ?? 0,
            traces_passed: 0, // Enriched per run rows — kept as 0 here (best-effort).
            traces_total: 0,
            cost_usd: latest.totalCostUsd ?? null,
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
        recall: latest && previous ? (latest.recall ?? 0) - (previous.recall ?? 0) : 0,
        precision:
          latest && previous ? (latest.precision ?? 0) - (previous.precision ?? 0) : 0,
        citation_accuracy:
          latest && previous
            ? (latest.citationAccuracy ?? 0) - (previous.citationAccuracy ?? 0)
            : 0,
      };

      // Recent runs = per-case rows of the latest group.
      let recentRuns: EvalRunRecord[] = [];
      if (latest) {
        recentRuns = await this.runRowsForGroup(latest.id);
      }

      results.push({
        owner_kind: ownerKind as 'skill' | 'agent',
        owner_id: ownerId,
        cases_total: casesTotal,
        current: currentMetrics,
        delta,
        trend,
        recent_runs: recentRuns,
        alert: null,
      });
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Private mappers
// ---------------------------------------------------------------------------

function rowToRunGroup(row: EvalRunGroupRow): EvalRunGroup {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner_kind: row.ownerKind as 'skill' | 'agent',
    owner_id: row.ownerId,
    agent_version: row.agentVersion,
    label: row.label ?? null,
    ran_at: row.ranAt.toISOString(),
    recall: row.recall ?? 0,
    precision: row.precision ?? 0,
    citation_accuracy: row.citationAccuracy ?? 0,
    total_cost_usd: row.totalCostUsd ?? null,
  };
}

function rowToRunRecord(row: EvalRunRow, caseName: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput ?? null,
    pass: row.pass ?? null,
    recall: row.recall ?? null,
    precision: row.precision ?? null,
    citation_accuracy: row.citationAccuracy ?? null,
    duration_ms: row.durationMs ?? null,
    cost_usd: row.costUsd ?? null,
    run_group_id: row.runGroupId ?? null,
  };
}
