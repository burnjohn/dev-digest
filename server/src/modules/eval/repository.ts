import { and, desc, eq, lt, asc } from 'drizzle-orm';
import type {
  EvalCaseMeta,
  EvalCaseOutcome,
  EvalExpectation,
  EvalOwnerKind,
  EvalRun,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * specs/12-eval-pipeline.md — the ONLY file in this module importing
 * `src/db/**` (finding 5: `no-cross-module` says nothing about `src/db/**`,
 * and `db-only-in-repositories` explicitly permits `repository.ts`). Owns
 * `eval_cases`/`eval_runs` CRUD plus the read-only lookups case creation and
 * execution need — `findings`/`reviews`/`pull_requests`/`pr_files`/
 * `agent_versions` are read directly here, never through another module's
 * repository (which would be a `no-cross-module` violation).
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: EvalCaseMeta;
  expectation: EvalExpectation;
  notes?: string | null;
  sourceFindingId?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  notes?: string | null;
  inputDiff?: string;
  inputFiles?: string[];
  inputMeta?: EvalCaseMeta;
  expectation?: EvalExpectation;
}

export interface InsertEvalRun {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  agentVersion: number | null;
  caseIds: string[];
  /** specs/15-skill-eval-cases.md D6/D2 — set only on a skill-owned run;
   *  `undefined` (→ column default/null) on every agent-owned run. */
  skillVersion?: number | null;
  carrierAgentId?: string | null;
  gatesBypassed?: boolean;
}

export interface CompleteEvalRun {
  status: 'completed' | 'errored';
  perCase: EvalCaseOutcome[];
  casesErrored: number;
  tracesPassed: number | null;
  tracesTotal: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  errorReason?: string | null;
  /** D3/clarification 5 — the without-arm's full `EvalRun`, stored only on a
   *  skill-owned run's completion. */
  armWithout?: EvalRun | null;
}

/** Everything `frozen-input.ts`/case-creation needs about a finding, joined
 *  through `reviews` → `pull_requests`, workspace-scoped in the WHERE clause
 *  itself (AC-54: a cross-workspace request never even reads the row). */
export interface FindingForCase {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  agentId: string | null;
  prId: string;
  prNumber: number;
  prTitle: string;
  prBody: string | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases -----------------------------------------------------

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles,
        inputMeta: values.inputMeta,
        expectedOutput: values.expectation,
        notes: values.notes ?? null,
        sourceFindingId: values.sourceFindingId ?? null,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /**
   * D17/AC-1's idempotency read — the DB unique index enforces it; this is
   * the pre-check that turns a would-be conflict into a 200-with-existing.
   *
   * specs/15-skill-eval-cases.md clarification 2 — OWNER-scoped, not finding-
   * alone: `eval_cases_source_finding_uq` is composite on
   * `(source_finding_id, owner_kind, owner_id)` (§2), because SPEC-12 already
   * writes an agent-owned case from a triaged finding and the same finding
   * can legitimately become a case for several different skills (each a
   * separate owner). The agent path uses this too — its owner is derived
   * from the finding's review either way, so this is behaviour-preserving.
   */
  async getCaseBySourceFindingForOwner(
    workspaceId: string,
    findingId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.sourceFindingId, findingId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return row;
  }

  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
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
      .orderBy(t.evalCases.createdAt);
  }

  async getCasesByIds(workspaceId: string, ids: string[]): Promise<EvalCaseRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, workspaceId));
    const idSet = new Set(ids);
    return rows.filter((r) => idSet.has(r.id));
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
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectation !== undefined ? { expectedOutput: patch.expectation } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** AC-14 — deletes the case row only; `eval_runs` has no FK to `eval_cases`
   *  (dropped in pass 2), so stored runs and their `per_case` arrays are
   *  never touched. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** D18 — deletes every case (and, via `deleteForOwner` below, every run)
   *  owned by this owner. Called from `AgentsService.delete` through the
   *  optional cascade port before the agent row itself is deleted. */
  async deleteForOwner(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<void> {
    await this.db
      .delete(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.ownerKind, ownerKind),
          eq(t.evalRuns.ownerId, ownerId),
        ),
      );
    await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  // ---- eval_runs --------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        agentVersion: values.agentVersion,
        caseIds: values.caseIds,
        status: 'running',
        ...(values.skillVersion !== undefined ? { skillVersion: values.skillVersion } : {}),
        ...(values.carrierAgentId !== undefined ? { carrierAgentId: values.carrierAgentId } : {}),
        ...(values.gatesBypassed !== undefined ? { gatesBypassed: values.gatesBypassed } : {}),
      })
      .returning();
    return row!;
  }

  async getRun(workspaceId: string, id: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, id)));
    return row;
  }

  async listRunsForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.ownerKind, ownerKind),
          eq(t.evalRuns.ownerId, ownerId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /** Recent runs across every owner in the workspace (AC-41's combined table). */
  async listRecentRuns(workspaceId: string, limit: number): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  /** AC-15's guard target — the one `running` row for this owner, if any. */
  async activeRunForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.ownerKind, ownerKind),
          eq(t.evalRuns.ownerId, ownerId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row;
  }

  async completeRun(id: string, values: CompleteEvalRun): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        status: values.status,
        perCase: values.perCase,
        casesErrored: values.casesErrored,
        tracesPassed: values.tracesPassed,
        tracesTotal: values.tracesTotal,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        errorReason: values.errorReason ?? null,
        finishedAt: new Date(),
        ...(values.armWithout !== undefined ? { armWithout: values.armWithout } : {}),
      })
      .where(eq(t.evalRuns.id, id));
  }

  /**
   * D19 — reconcile `running` rows older than `cutoff` to `errored`.
   * Scoped to one owner when `scope` is given (the per-request path, before
   * AC-15's guard); unscoped on boot (mirrors
   * `modules/reviews/repository/run.repo.ts`'s `reapStaleRunningRuns`).
   */
  async reconcileStaleRunning(
    cutoff: Date,
    scope?: { workspaceId: string; ownerKind: EvalOwnerKind; ownerId: string },
  ): Promise<number> {
    const where = scope
      ? and(
          eq(t.evalRuns.status, 'running'),
          lt(t.evalRuns.ranAt, cutoff),
          eq(t.evalRuns.workspaceId, scope.workspaceId),
          eq(t.evalRuns.ownerKind, scope.ownerKind),
          eq(t.evalRuns.ownerId, scope.ownerId),
        )
      : and(eq(t.evalRuns.status, 'running'), lt(t.evalRuns.ranAt, cutoff));
    const rows = await this.db
      .update(t.evalRuns)
      .set({ status: 'errored', errorReason: 'interrupted', finishedAt: new Date() })
      .where(where)
      .returning({ id: t.evalRuns.id });
    return rows.length;
  }

  /** Distinct owner ids in this workspace that own at least one eval case
   *  for the given owner kind (AC-40's agent dashboard row set is driven
   *  from `AgentLookup.listEnabled` instead — see `service.ts` — this is
   *  used where "has any cases at all" needs a cheap existence check; the
   *  skills dashboard section (specs/15-skill-eval-cases.md AC-39) drives
   *  its row set from this, parameterised to `'skill'`). */
  async ownersWithCases(workspaceId: string, ownerKind: EvalOwnerKind): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ ownerId: t.evalCases.ownerId })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, ownerKind)));
    return rows.map((r) => r.ownerId);
  }

  // ---- read-only lookups for case creation / execution -------------------

  /** AC-54 — workspace-scoped in the WHERE clause itself: a finding from
   *  another workspace is never read, let alone returned. */
  async findingForCase(workspaceId: string, findingId: string): Promise<FindingForCase | undefined> {
    const [row] = await this.db
      .select({
        finding: t.findings,
        agentId: t.reviews.agentId,
        prId: t.pullRequests.id,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
        prBody: t.pullRequests.body,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.reviews.prId))
      .where(and(eq(t.findings.id, findingId), eq(t.pullRequests.workspaceId, workspaceId)));
    if (!row) return undefined;
    return {
      finding: {
        id: row.finding.id,
        file: row.finding.file,
        startLine: row.finding.startLine,
        endLine: row.finding.endLine,
        severity: row.finding.severity,
        category: row.finding.category,
        title: row.finding.title,
        acceptedAt: row.finding.acceptedAt,
        dismissedAt: row.finding.dismissedAt,
      },
      agentId: row.agentId,
      prId: row.prId,
      prNumber: row.prNumber,
      prTitle: row.prTitle,
      prBody: row.prBody,
    };
  }

  /** finding 8 — one `pr_files` row's raw GitHub patch (hunks only, no
   *  `diff --git`/`---`/`+++` header). Null when the PR has no patch text
   *  for that file (the PR #482 shape, Q4) or the file isn't in the PR. */
  async filePatch(prId: string, path: string): Promise<string | null | undefined> {
    const [row] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, path)));
    return row?.patch;
  }

  /** AC-34 — a past agent config version's system prompt, for the compare
   *  view's prompt diff. */
  async agentVersionPrompt(agentId: string, version: number): Promise<string | undefined> {
    const [row] = await this.db
      .select({ configJson: t.agentVersions.configJson })
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    if (!row) return undefined;
    const config = row.configJson as { system_prompt?: string } | null;
    return config?.system_prompt;
  }

  // ---- specs/15-skill-eval-cases.md — skill-owned run/case lookups --------

  /** AC-53 — a skill row, workspace-scoped in the WHERE clause itself. Read
   *  directly regardless of `skills.enabled` (D8's gate bypass, §5) — this
   *  is the source of the with-arm's rendered block. */
  async skillForEval(workspaceId: string, skillId: string): Promise<SkillForEval | undefined> {
    const [row] = await this.db
      .select({
        id: t.skills.id,
        name: t.skills.name,
        type: t.skills.type,
        body: t.skills.body,
        version: t.skills.version,
        enabled: t.skills.enabled,
      })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row;
  }

  /**
   * D2/D11/AC-11/AC-49/R5 — the agents currently linked to this skill, with
   * both gate states and `order` (R5's deterministic auto-carrier tie-break:
   * lowest `agent_skills.order`, ties broken by agent name). Workspace-
   * scoped through the `agents` join, so a carrier from another workspace
   * can never appear in this list (AC-53).
   */
  async carriersForSkill(workspaceId: string, skillId: string): Promise<CarrierForSkill[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        systemPrompt: t.agents.systemPrompt,
        strategy: t.agents.strategy,
        agentVersion: t.agents.version,
        order: t.agentSkills.order,
        linkEnabled: t.agentSkills.enabled,
        skillEnabled: t.skills.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agentSkills.skillId, skillId)))
      .orderBy(asc(t.agentSkills.order), asc(t.agents.name));
    return rows;
  }

  /**
   * D10/AC-2 — the identical `run_skills` → `agent_runs` → `reviews.run_id`
   * → `findings` join the Stats tab already performs
   * (`modules/skills/repository.ts` `findingCounts`), read from the OTHER
   * direction: given a finding, which skills did the run that produced it
   * actually inject. A review whose run predates `run_skills` (no `run_id`,
   * or no rows for that run) yields an empty list — AC-2's correct empty
   * state, not an error.
   */
  async skillsInjectedForFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<InjectedSkillForFinding[]> {
    const rows = await this.db
      .select({
        skillId: t.skills.id,
        skillName: t.skills.name,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.runSkills, eq(t.runSkills.runId, t.reviews.runId))
      .innerJoin(t.skills, eq(t.skills.id, t.runSkills.skillId))
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.reviews.prId))
      .where(and(eq(t.findings.id, findingId), eq(t.pullRequests.workspaceId, workspaceId)))
      .orderBy(asc(t.runSkills.order));
    return rows;
  }

  /**
   * AC-33 — a past skill body version, for the compare view's body diff.
   * `skill_versions` only ever holds SUPERSEDED bodies (the current body is
   * never archived until superseded — `modules/skills/service.ts`'s own
   * comment on this) — falls back to the skill's current body when the
   * requested version IS the current one, so a compare against the
   * still-current version doesn't need a special case at the call site.
   */
  async skillVersionBody(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<string | undefined> {
    const skill = await this.skillForEval(workspaceId, skillId);
    if (!skill) return undefined;
    if (skill.version === version) return skill.body;
    const [row] = await this.db
      .select({ body: t.skillVersions.body })
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row?.body;
  }
}

/** The subset of a `skills` row a skill-owned eval run needs — read
 *  directly, bypassing both enable gates (D8, §5). */
export interface SkillForEval {
  id: string;
  name: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  body: string;
  version: number;
  enabled: boolean;
}

/** One agent linked to a skill, with both gate states — `AgentRecord`'s
 *  fields plus what the carrier picker (AC-11) and R5's auto-selection need. */
export interface CarrierForSkill {
  agentId: string;
  agentName: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  agentVersion: number;
  order: number;
  linkEnabled: boolean;
  skillEnabled: boolean;
}

export interface InjectedSkillForFinding {
  skillId: string;
  skillName: string;
}
