import { and, asc, desc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseRow, EvalRunRow, EvalBatchRow } from '../../db/rows.js';

export type { EvalCaseRow, EvalRunRow, EvalBatchRow };

/**
 * A7 — evals data-access (SPEC-03). Owns `eval_cases` and `eval_runs`, plus the
 * writes/terminal-read of `eval_run_batches`. The only place in `modules/evals/**`
 * where `drizzle-orm` and `db/schema` appear (onion-architecture §2).
 *
 * Every case/run/batch method takes `workspaceId` and scopes its query by it
 * (REQ-40) — a row belonging to another workspace is never returned, never
 * updated, never deleted. `eval_runs` carries no `workspace_id` of its own; its
 * two scoped methods (`insertRun`, `getNonTerminalBatchForCase`) reach tenancy
 * through a join to the tables that DO carry it.
 *
 * Row types travel via `db/rows.ts`; a contract type (`@devdigest/shared`)
 * never enters a signature here — mapping row → DTO is `helpers.ts`'s job
 * (onion-architecture §1, "Where Zod contracts sit").
 *
 * REQ-41's owner-cascade (deleting an agent/skill deletes ITS eval_cases/
 * batches) is deliberately NOT here — it is triggered by `DELETE /agents/:id`
 * and `DELETE /skills/:id`, whose repositories own it (T22). A copy here would
 * be unreachable dead code.
 */

/** Mirrors `eval_cases.owner_kind` / `eval_run_batches.owner_kind` (`db/schema/eval.ts`).
 * Deliberately NOT the wire `EvalOwnerKind` contract — repository signatures stay
 * contract-free (onion-architecture §2, R3 row). */
export type EvalOwnerKindRow = 'skill' | 'agent';

/** Mirrors `eval_cases.expectation_kind`. Derived server-side (AC-43); the
 * repository persists whatever the caller already derived, it does not derive it. */
export type EvalExpectationKindRow = 'must_find' | 'must_not_flag';

/** Mirrors `eval_run_batches.status` — plain `text`, no DB-level CHECK (T2). */
export type EvalBatchStatusRow = 'running' | 'succeeded' | 'partial' | 'failed';

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKindRow;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
  expectationKind?: EvalExpectationKindRow | null;
  forbiddenRegions?: unknown;
  inputFilename?: string | null;
  seededFrom?: 'accepted' | 'dismissed' | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
  expectationKind?: EvalExpectationKindRow | null;
  forbiddenRegions?: unknown;
  inputFilename?: string | null;
  seededFrom?: 'accepted' | 'dismissed' | null;
}

export interface InsertEvalRun {
  caseId: string;
  /** Nullable — a single ad-hoc run (AC-11/AC-50) is not part of a batch. */
  batchId?: string | null;
  actualOutput?: unknown;
  pass?: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

export interface InsertEvalBatch {
  workspaceId: string;
  ownerKind: EvalOwnerKindRow;
  ownerId: string;
  ownerVersion: number;
  /** The agent that supplied the prompt/model for a SKILL batch (AC-68); null on an agent batch. */
  runnerAgentId?: string | null;
  runnerAgentVersion?: number | null;
  /** Override for deterministic ordering in tests; defaults to the DB's `now()`. */
  startedAt?: Date;
  /**
   * How many cases this batch was started with, written UP FRONT so a client
   * polling a still-`running` batch has a denominator (`n/m` progress). It was
   * previously left NULL until `completeBatch`, which the wire mapping
   * coalesces to `0` — so the studio's progress line read `5/0` for the whole
   * run. `completeBatch` still writes the attempted count over it.
   */
  casesTotal?: number | null;
}

/**
 * A batch inserted ALREADY TERMINAL — `EvalsService.runCase`'s batch of 1.
 *
 * Deliberately a separate shape from `InsertEvalBatch`, which hard-codes
 * `status: 'running'`: the batch-runner's invariant that a freshly inserted
 * batch is always `running` stays true, and this path's own invariant — the
 * row is NEVER `running`, not even for one round-trip — is equally explicit.
 * That is what keeps a single-case run out of `findLiveRunningBatch`'s live
 * check (so it neither takes nor is blocked by the owner's batch lock) and out
 * of `reapStaleRunningBatches`' reach (so it can never be orphaned into a
 * mystery `0/N` row by a restart).
 */
export interface InsertCompletedEvalBatch extends CompleteEvalBatch {
  workspaceId: string;
  ownerKind: EvalOwnerKindRow;
  ownerId: string;
  ownerVersion: number;
  runnerAgentId?: string | null;
  runnerAgentVersion?: number | null;
  /** Override for deterministic ordering in tests; defaults to the DB's `now()`. */
  startedAt?: Date;
}

export interface CompleteEvalBatch {
  status: Exclude<EvalBatchStatusRow, 'running'>;
  finishedAt?: Date;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  casesPassed?: number | null;
  casesTotal?: number | null;
  costUsd?: number | null;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // =========================================================================
  // Cases — REQ-7, REQ-12, REQ-40
  // =========================================================================

  /**
   * REQ-7 — every case for one owner in the caller's workspace, `name` asc with
   * `id` asc breaking a tie. `id` is the unique immutable key that makes the
   * order total and stable across refetches — `name` alone is not
   * (`server/INSIGHTS.md`, 2026-08-17).
   */
  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKindRow,
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
      )
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
  }

  async getCaseById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
        expectationKind: values.expectationKind ?? null,
        forbiddenRegions: values.forbiddenRegions ?? null,
        seededFrom: values.seededFrom ?? null,
        inputFilename: values.inputFilename ?? null,
      })
      .returning();
    if (!row) throw new Error('eval_cases insert returned no row');
    return row;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.expectationKind !== undefined
          ? { expectationKind: patch.expectationKind }
          : {}),
        ...(patch.forbiddenRegions !== undefined
          ? { forbiddenRegions: patch.forbiddenRegions }
          : {}),
        ...(patch.inputFilename !== undefined ? { inputFilename: patch.inputFilename } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /**
   * REQ-12 — deletes the case; `eval_runs.case_id` is `ON DELETE CASCADE`
   * (`db/schema/eval.ts`), so its run rows go with it in the same statement.
   */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // =========================================================================
  // Runs — REQ-28
  // =========================================================================

  /**
   * REQ-28 — one `eval_runs` row per case per batch. `batch_id` is nullable on
   * the row (an ad-hoc single-case run has none) and round-trips whatever the
   * caller passes, including `null`/omitted.
   */
  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId ?? null,
        actualOutput: values.actualOutput ?? null,
        pass: values.pass ?? null,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
      })
      .returning();
    if (!row) throw new Error('eval_runs insert returned no row');
    return row;
  }

  /**
   * Latest-run-per-case: one row per id in `caseIds`, the most recent by
   * `ran_at` with `id` breaking a tie — powers the case list's pass/fail badge
   * without a caller-side N+1. `DISTINCT ON` needs its leading `ORDER BY`
   * column to match its own argument (Drizzle docs, "PostgreSQL selectDistinctOn").
   */
  async getLatestRunsByCase(caseIds: string[]): Promise<EvalRunRow[]> {
    if (caseIds.length === 0) return [];
    return this.db
      .selectDistinctOn([t.evalRuns.caseId])
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(t.evalRuns.caseId, desc(t.evalRuns.ranAt), desc(t.evalRuns.id));
  }

  /** Every run row for one batch — the batch detail's per-case results and its live progress count. */
  async listRunsForBatch(batchId: string): Promise<EvalRunRow[]> {
    return this.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
  }

  // =========================================================================
  // Batches — REQ-30, REQ-31, REQ-37, REQ-40, REQ-69, REQ-70
  // =========================================================================

  async insertBatch(values: InsertEvalBatch): Promise<EvalBatchRow> {
    const [row] = await this.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        ownerVersion: values.ownerVersion,
        runnerAgentId: values.runnerAgentId ?? null,
        runnerAgentVersion: values.runnerAgentVersion ?? null,
        status: 'running',
        casesTotal: values.casesTotal ?? null,
        ...(values.startedAt !== undefined ? { startedAt: values.startedAt } : {}),
      })
      .returning();
    if (!row) throw new Error('eval_run_batches insert returned no row');
    return row;
  }

  /**
   * One `eval_run_batches` row written straight to its terminal state —
   * status, `finished_at` and every aggregate set at INSERT, so the row is
   * never observable as `running`. See `InsertCompletedEvalBatch` for why that
   * matters. Used only by `EvalsService.runCase`; a set run still goes
   * `insertBatch` (running) -> `completeBatch`.
   */
  async insertCompletedBatch(values: InsertCompletedEvalBatch): Promise<EvalBatchRow> {
    const [row] = await this.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        ownerVersion: values.ownerVersion,
        runnerAgentId: values.runnerAgentId ?? null,
        runnerAgentVersion: values.runnerAgentVersion ?? null,
        status: values.status,
        finishedAt: values.finishedAt ?? new Date(),
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        casesPassed: values.casesPassed ?? null,
        casesTotal: values.casesTotal ?? null,
        costUsd: values.costUsd ?? null,
        ...(values.startedAt !== undefined ? { startedAt: values.startedAt } : {}),
      })
      .returning();
    if (!row) throw new Error('eval_run_batches insert returned no row');
    return row;
  }

  /**
   * On boot: a batch left `running` is ORPHANED. Its loop lives in the process
   * that started it (`startAgentBatch` hands off to `setImmediate`, nothing is
   * queued or resumable), so a restart strands the row forever — the studio
   * then renders that owner's cases as running/queued for good and keeps
   * `Run all evals` disabled. Marked `failed` with a `finishedAt`, exactly as
   * `reapStaleRunningRuns` does for `agent_runs`, and workspace-wide for the
   * same reason: a fresh process owns no batch of its own yet. Assumes ONE API
   * instance per DB, like that reaper.
   */
  async reapStaleRunningBatches(): Promise<number> {
    const rows = await this.db
      .update(t.evalRunBatches)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(t.evalRunBatches.status, 'running'))
      .returning({ id: t.evalRunBatches.id });
    return rows.length;
  }

  async getBatchById(workspaceId: string, id: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.id, id)));
    return row;
  }

  /**
   * The only write that may move a batch away from `running`. `finishedAt`
   * defaults to `now()` but accepts an override so a caller (or a test) can
   * backdate it — the trailing-30-day trend read (REQ-37) depends on being able
   * to place a batch outside the window deterministically.
   */
  async completeBatch(
    workspaceId: string,
    id: string,
    patch: CompleteEvalBatch,
  ): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .update(t.evalRunBatches)
      .set({
        status: patch.status,
        finishedAt: patch.finishedAt ?? new Date(),
        recall: patch.recall ?? null,
        precision: patch.precision ?? null,
        citationAccuracy: patch.citationAccuracy ?? null,
        casesPassed: patch.casesPassed ?? null,
        casesTotal: patch.casesTotal ?? null,
        costUsd: patch.costUsd ?? null,
      })
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.id, id)))
      .returning();
    return row;
  }

  /**
   * REQ-31 — every batch for one owner, `started_at` desc with `id` desc
   * breaking a tie.
   *
   * `limit` caps the newest N. Unbounded by default (REQ-31's own reads want
   * the whole history), but the dashboard passes one: `recent_batches` carries
   * this list for EVERY agent on a single `GET /evals/dashboard`, and now that
   * a single-case run persists its own batch of 1, that history grows by a row
   * per CLICK rather than per set run.
   */
  async listBatchHistory(
    workspaceId: string,
    ownerKind: EvalOwnerKindRow,
    ownerId: string,
    limit?: number,
  ): Promise<EvalBatchRow[]> {
    const q = this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.ownerKind, ownerKind),
          eq(t.evalRunBatches.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRunBatches.startedAt), desc(t.evalRunBatches.id));
    return limit === undefined ? q : q.limit(limit);
  }

  /**
   * REQ-30 — the single terminal batch with the greatest `finished_at`, `id`
   * breaking a tie. "Terminal" is `status !== 'running' AND finished_at IS NOT
   * NULL` (matches `helpers.ts::isTerminalBatch`) — a `running` batch is never
   * selected, and no figure here is derived by averaging across rows.
   */
  async getLatestTerminalBatch(
    workspaceId: string,
    ownerKind: EvalOwnerKindRow,
    ownerId: string,
  ): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.ownerKind, ownerKind),
          eq(t.evalRunBatches.ownerId, ownerId),
          ne(t.evalRunBatches.status, 'running'),
          isNotNull(t.evalRunBatches.finishedAt),
        ),
      )
      .orderBy(desc(t.evalRunBatches.finishedAt), desc(t.evalRunBatches.id))
      .limit(1);
    return row;
  }

  /**
   * REQ-37 — terminal batches whose `finished_at` falls inside the trailing
   * `days` (default 30), ascending `finished_at` order. An owner whose every
   * batch is older than the window gets `[]`, never the newest row outside it
   * — the window is enforced IN the query, not by the caller filtering after.
   */
  async getTrendBatches(
    workspaceId: string,
    ownerKind: EvalOwnerKindRow,
    ownerId: string,
    days = 30,
  ): Promise<EvalBatchRow[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.ownerKind, ownerKind),
          eq(t.evalRunBatches.ownerId, ownerId),
          ne(t.evalRunBatches.status, 'running'),
          isNotNull(t.evalRunBatches.finishedAt),
          gte(t.evalRunBatches.finishedAt, since),
        ),
      )
      .orderBy(asc(t.evalRunBatches.finishedAt), asc(t.evalRunBatches.id));
  }

  /**
   * REQ-70 — the non-terminal (`running`) batch that already has a run row for
   * `caseId`, or none. `eval_run_batches` carries no `case_id` of its own — the
   * only artifact linking a batch to a specific case is an `eval_runs` row, so
   * this reaches tenancy through `eval_run_batches.workspace_id` via the join.
   */
  async getNonTerminalBatchForCase(
    workspaceId: string,
    caseId: string,
  ): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select({ batch: t.evalRunBatches })
      .from(t.evalRunBatches)
      .innerJoin(t.evalRuns, eq(t.evalRuns.batchId, t.evalRunBatches.id))
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRuns.caseId, caseId),
          eq(t.evalRunBatches.status, 'running'),
        ),
      )
      .limit(1);
    return row?.batch;
  }

  // =========================================================================
  // Cross-table reads the evals module needs, kept here so `modules/evals/**`
  // never imports `modules/agents/**` or `modules/skills/**` (onion-architecture,
  // "No module imports another module").
  // =========================================================================

  /** `agents.system_prompt`/`model`/`version`/`enabled` — what a batch runner needs to run an agent. */
  async getAgentSummary(
    workspaceId: string,
    agentId: string,
  ): Promise<
    { systemPrompt: string; model: string; version: number; enabled: boolean } | undefined
  > {
    const [row] = await this.db
      .select({
        systemPrompt: t.agents.systemPrompt,
        model: t.agents.model,
        version: t.agents.version,
        enabled: t.agents.enabled,
      })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row;
  }

  /** `agent_versions.config_json` for one historical version, scoped through a join to `agents`. */
  async getAgentVersionConfig(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<unknown> {
    const [row] = await this.db
      .select({ configJson: t.agentVersions.configJson })
      .from(t.agentVersions)
      .innerJoin(t.agents, eq(t.agents.id, t.agentVersions.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agentVersions.agentId, agentId),
          eq(t.agentVersions.version, version),
        ),
      );
    return row?.configJson;
  }

  /**
   * AC-68/T-C — a skill's own `version` and `body`, agent-free. The only
   * previous path to a skill's `version` went through the now-removed
   * `agent_skills`-joined runner resolution (`service.ts`'s deleted
   * `resolveSkillRunner`), which AC-68 forbids consulting for a batch start —
   * `eval_run_batches.owner_version` needs this instead.
   */
  async getSkillSummary(
    workspaceId: string,
    skillId: string,
  ): Promise<{ version: number; body: string } | undefined> {
    const [row] = await this.db
      .select({ version: t.skills.version, body: t.skills.body })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row;
  }

  /** A skill's `body` as of a specific historical version (`skill_versions`). */
  async getSkillVersionBody(skillId: string, version: number): Promise<string | undefined> {
    const [row] = await this.db
      .select({ body: t.skillVersions.body })
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row?.body;
  }

  /** `agent_skills.order`, ascending — the skill-injection order for an agent's prompt. */
  async listAgentSkillsOrder(agentId: string): Promise<Array<{ skillId: string; order: number }>> {
    return this.db
      .select({ skillId: t.agentSkills.skillId, order: t.agentSkills.order })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
  }
}
