import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A4 — eval data-access. Owns `eval_cases` and `eval_runs`. Cases are
 * workspace-scoped; runs are scoped through their parent case.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases --------------------------------------------------------------

  async listCases(
    workspaceId: string,
    filter?: { ownerKind?: 'agent' | 'skill'; ownerId?: string },
  ): Promise<EvalCaseRow[]> {
    const conds = [eq(t.evalCases.workspaceId, workspaceId)];
    if (filter?.ownerKind) conds.push(eq(t.evalCases.ownerKind, filter.ownerKind));
    if (filter?.ownerId) conds.push(eq(t.evalCases.ownerId, filter.ownerId));
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(...conds));
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
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
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: Partial<InsertEvalCase>,
  ): Promise<EvalCaseRow | undefined> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.inputDiff !== undefined) set.inputDiff = patch.inputDiff;
    if (patch.inputFiles !== undefined) set.inputFiles = patch.inputFiles;
    if (patch.inputMeta !== undefined) set.inputMeta = patch.inputMeta;
    if (patch.expectedOutput !== undefined) set.expectedOutput = patch.expectedOutput;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.ownerKind !== undefined) set.ownerKind = patch.ownerKind;
    if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
    if (Object.keys(set).length === 0) return this.getCase(workspaceId, id);
    const [row] = await this.db
      .update(t.evalCases)
      .set(set)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
  }

  // ---- runs ---------------------------------------------------------------

  async insertRun(values: {
    caseId: string;
    actualOutput: unknown;
    pass: boolean;
    recall: number;
    precision: number;
    citationAccuracy: number;
    durationMs: number;
    costUsd: number | null;
  }): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: values.actualOutput ?? null,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
      })
      .returning();
    return row!;
  }

  /** Runs for a set of cases, newest first. */
  async runsForCases(caseIds: string[]): Promise<EvalRunRow[]> {
    if (caseIds.length === 0) return [];
    return this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));
  }

  async runsForCase(caseId: string): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, caseId))
      .orderBy(desc(t.evalRuns.ranAt));
  }
}
