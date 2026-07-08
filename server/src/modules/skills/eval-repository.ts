import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { ConfigError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';

// Row shapes (Drizzle's inferred select/insert types for the eval tables).
// EvalCaseRow/EvalRunRow are re-exported from `../../db/rows.js` elsewhere in
// the codebase (see `eval/repository.ts`), but this module mirrors that
// convention with local aliases so it never needs to import another module's
// repository file (R6 — infrastructure-only, own-module files + shared +
// container + db only).
type EvalCaseRow = typeof t.evalCases.$inferSelect;
type EvalRunRow = typeof t.evalRuns.$inferSelect;
type EvalRunInsert = typeof t.evalRuns.$inferInsert;
type SkillEvalBatchRow = typeof t.skillEvalBatches.$inferSelect;
type SkillEvalBatchInsert = typeof t.skillEvalBatches.$inferInsert;

/**
 * SkillEvalRepository — infrastructure-only DB access for the skill-eval
 * pipeline's run/batch/history queries (L06 sibling feature, see
 * docs/plans/2026-07-06-skill-eval-pipeline.md).
 *
 * Case CRUD (`insertCase`/`updateCase`/`deleteCase`/`listCases`-style writes)
 * is intentionally NOT duplicated here — `eval_cases` rows with
 * `owner_kind='skill'` are already owned by `SkillsRepository`
 * (`insertEvalCase`/`listEvalCases`/`deleteEvalCase`,
 * `server/src/modules/skills/repository.ts:265-315`), which already accepts
 * an arbitrary `expected_output: unknown` payload — sufficient for this
 * feature's `{practices, grounding, threshold}` JSON shape with no change.
 * The Step 5 service reuses those methods directly. This repository owns
 * ONLY the run-adjacent reads: `listCases` DELEGATES to
 * `SkillsRepository.listEvalCases` (single source of truth for that query —
 * same-module composition, allowed under R6), and `getCase` is a single-row
 * read with NO `SkillsRepository` equivalent — plus the new
 * skill_eval_batches / eval_runs.skill_batch_id queries.
 *
 * `SkillsRepository` currently has NO `updateEvalCase` method — flagged as a
 * gap for Step 5 (the service layer), which will need one for the
 * `PATCH /skills/:id/evals/:caseId` edit route (AC-39). Not added here to
 * avoid scope creep into another module's repository from this file.
 *
 * Every method is workspace-scoped: either directly (`skill_eval_batches`
 * has its own `workspace_id` column) or transitively (`eval_runs` has none
 * of its own — scope flows through a `skillId`/`batchId` the caller has
 * already resolved/verified in the workspace before calling).
 */
export class SkillEvalRepository {
  constructor(private db: Db) {}

  // -------------------------------------------------------------- eval_cases

  /**
   * Skill-owned eval cases for the given skill, workspace-scoped directly
   * (`eval_cases.workspace_id`). Delegates to `SkillsRepository.listEvalCases`
   * — the single source of truth for this query — rather than duplicating the
   * SELECT. Same-module composition is allowed (R6 forbids importing ANOTHER
   * module's repository, not a sibling file in this same module).
   */
  async listCases(workspaceId: string, skillId: string): Promise<EvalCaseRow[]> {
    return new SkillsRepository(this.db).listEvalCases(workspaceId, skillId);
  }

  /** A single skill-owned eval case row, or null if it doesn't exist / isn't in this workspace. */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.id, caseId),
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------- eval_runs

  /**
   * Most recent eval_runs row for a case that belongs to a SKILL-EVAL batch
   * (`skill_batch_id IS NOT NULL`), feeding `last_run_status`/
   * `last_run_summary`. `eval_runs` has no `workspace_id` of its own; scope
   * is transitive via `eval_cases` — callers must have already
   * resolved/verified the case in the workspace (e.g. via
   * `getCase(workspaceId, caseId)`) before calling this.
   */
  async latestRunForCase(caseId: string): Promise<EvalRunRow | null> {
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.caseId, caseId), isNotNull(t.evalRuns.skillBatchId)))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert a new eval_runs row with `skill_batch_id` populated (`batch_id` left null — mutually exclusive). */
  async insertRun(data: EvalRunInsert): Promise<EvalRunRow> {
    const [row] = await this.db.insert(t.evalRuns).values(data).returning();
    if (!row) throw new ConfigError('insertRun: insert returned no row');
    return row;
  }

  /**
   * Per-case eval_runs rows belonging to a skill-eval batch (batch detail
   * view). `eval_runs` has no `workspace_id` of its own; scope is transitive
   * via `skillId` — callers must have already resolved/verified the batch in
   * the workspace (e.g. via `getBatch(workspaceId, batchId)`) before calling
   * this.
   */
  async runsForBatch(batchId: string): Promise<EvalRunRow[]> {
    return this.db.select().from(t.evalRuns).where(eq(t.evalRuns.skillBatchId, batchId));
  }

  // ------------------------------------------------------- skill_eval_batches

  /** Insert a new skill_eval_batches row; returns the inserted row. */
  async insertBatch(data: SkillEvalBatchInsert): Promise<SkillEvalBatchRow> {
    const [row] = await this.db.insert(t.skillEvalBatches).values(data).returning();
    if (!row) throw new ConfigError('insertBatch: insert returned no row');
    return row;
  }

  /** Update the aggregate metrics on a batch once all its case-runs complete. */
  async updateBatchAggregate(
    batchId: string,
    metrics: {
      judgeScore: number | null;
      groundingPassRate: number | null;
      casesPassing: number | null;
      casesTotal: number;
      costUsd: number | null;
      status: 'clean' | 'degraded';
    },
  ): Promise<void> {
    await this.db
      .update(t.skillEvalBatches)
      .set({
        judgeScore: metrics.judgeScore,
        groundingPassRate: metrics.groundingPassRate,
        casesPassing: metrics.casesPassing,
        casesTotal: metrics.casesTotal,
        costUsd: metrics.costUsd,
        status: metrics.status,
      })
      .where(eq(t.skillEvalBatches.id, batchId));
  }

  /** All batches for a skill, newest first — `skill_eval_batches.workspace_id` scoped directly. */
  async listBatchHistory(workspaceId: string, skillId: string): Promise<SkillEvalBatchRow[]> {
    return this.db
      .select()
      .from(t.skillEvalBatches)
      .where(and(eq(t.skillEvalBatches.workspaceId, workspaceId), eq(t.skillEvalBatches.skillId, skillId)))
      .orderBy(desc(t.skillEvalBatches.ranAt));
  }

  /** A single batch row, or null — `skill_eval_batches.workspace_id` scoped directly. */
  async getBatch(workspaceId: string, batchId: string): Promise<SkillEvalBatchRow | null> {
    const rows = await this.db
      .select()
      .from(t.skillEvalBatches)
      .where(and(eq(t.skillEvalBatches.id, batchId), eq(t.skillEvalBatches.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 'full'-kind batches only for a skill, newest first (trend chart).
   * `status IS NOT NULL` excludes unsealed batches — a batch row is inserted
   * with `status: null` BEFORE its cases run (`SkillEvalOrchestrator.startBatch`),
   * so an in-flight or crash-orphaned full batch would otherwise plot as a
   * false clean 0%/0%/0% dip. `desc(id)` is a secondary sort key so two
   * batches sharing an identical `ran_at` instant order deterministically.
   * Mirrors `eval/repository.ts`'s `listTrendBatches` exactly.
   */
  async listTrendBatches(workspaceId: string, skillId: string): Promise<SkillEvalBatchRow[]> {
    return this.db
      .select()
      .from(t.skillEvalBatches)
      .where(
        and(
          eq(t.skillEvalBatches.workspaceId, workspaceId),
          eq(t.skillEvalBatches.skillId, skillId),
          eq(t.skillEvalBatches.kind, 'full'),
          isNotNull(t.skillEvalBatches.status),
        ),
      )
      .orderBy(desc(t.skillEvalBatches.ranAt), desc(t.skillEvalBatches.id));
  }

  /**
   * The most recent 'full'-kind batch that ran strictly before `beforeRanAt`
   * (KPI-delta baseline). `status IS NOT NULL` excludes unsealed batches — an
   * in-flight/crashed full batch must never be used as a baseline. `desc(id)`
   * is a secondary sort key so a tied `ran_at` can't cause the strict `<` to
   * skip a true predecessor nondeterministically. Mirrors `eval/repository.ts`'s
   * `previousFullBatch` exactly.
   */
  async previousFullBatch(
    workspaceId: string,
    skillId: string,
    beforeRanAt: Date,
  ): Promise<SkillEvalBatchRow | null> {
    const rows = await this.db
      .select()
      .from(t.skillEvalBatches)
      .where(
        and(
          eq(t.skillEvalBatches.workspaceId, workspaceId),
          eq(t.skillEvalBatches.skillId, skillId),
          eq(t.skillEvalBatches.kind, 'full'),
          isNotNull(t.skillEvalBatches.status),
          lt(t.skillEvalBatches.ranAt, beforeRanAt),
        ),
      )
      .orderBy(desc(t.skillEvalBatches.ranAt), desc(t.skillEvalBatches.id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Clear ALL run history (skill_eval_batches + eval_runs) for one skill,
   * workspace-scoped, in a SINGLE transaction — `eval_cases` (the case
   * definitions) are NEVER touched, only their run history.
   * `eval_runs.skill_batch_id → skill_eval_batches` is `ON DELETE SET NULL`
   * (schema/eval.ts), so deleting batches alone would NOT remove the skill's
   * runs — they must be deleted explicitly via the `eval_cases.id` subquery
   * (`eval_runs` has no `workspace_id`/`skill_id` of its own; scope flows
   * transitively through `eval_cases.owner_id`/`owner_kind`). Runs deleted
   * first, then batches, inside one transaction so a mid-way failure leaves
   * neither partially cleared. Mirrors `eval/repository.ts`'s `clearHistory`
   * exactly.
   */
  async clearHistory(
    workspaceId: string,
    skillId: string,
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
                  eq(t.evalCases.ownerId, skillId),
                  eq(t.evalCases.ownerKind, 'skill'),
                ),
              ),
          ),
        )
        .returning({ id: t.evalRuns.id });

      const deletedBatches = await tx
        .delete(t.skillEvalBatches)
        .where(and(eq(t.skillEvalBatches.workspaceId, workspaceId), eq(t.skillEvalBatches.skillId, skillId)))
        .returning({ id: t.skillEvalBatches.id });

      return { deletedBatches: deletedBatches.length, deletedRuns: deletedRuns.length };
    });
  }
}
