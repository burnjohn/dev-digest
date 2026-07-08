import { and, asc, desc, eq, count, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, SkillVersionRow, EvalCaseRow } from '../../db/rows.js';
import type { SkillType, SkillSource, SkillStats } from '@devdigest/shared';

export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

/**
 * A1 — skills data-access. Owns `skills`, `skill_versions`, and the eval_cases
 * rows whose owner_kind='skill'. Workspace-scoped throughout.
 */
export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND record version 1 in skill_versions. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
      })
      .returning();
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: values.body });
    return row!;
  }

  /**
   * Update a skill. A body change bumps the version and writes a new snapshot to
   * skill_versions — every saved body is an immutable historical record.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { body: patch.body!, version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) {
      await this.db.insert(t.skillVersions).values({
        skillId: id,
        version: nextVersion,
        body: patch.body!,
      });
    }
    return row;
  }

  /**
   * Delete a skill. Explicitly removes eval_cases for this skill (no FK cascade
   * since owner_id is polymorphic). skill_versions + agent_skills cascade via FK.
   */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return false;

    await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, id),
          eq(t.evalCases.workspaceId, workspaceId),
        ),
      );

    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** All version snapshots for a skill, newest first. */
  async versions(workspaceId: string, skillId: string): Promise<SkillVersionRow[]> {
    const skill = await this.getById(workspaceId, skillId);
    if (!skill) return [];
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** Restore a specific version body to the current skill (bumps version again). */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const [vRow] = await this.db
      .select()
      .from(t.skillVersions)
      .where(
        and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)),
      );
    if (!vRow) return undefined;
    return this.update(workspaceId, skillId, { body: vRow.body });
  }

  /** Lightweight usage stats for the Stats tab. */
  async stats(workspaceId: string, skillId: string): Promise<SkillStats> {
    const skill = await this.getById(workspaceId, skillId);
    if (!skill) {
      return {
        used_by: 0,
        pull_frequency_pct: 0,
        accept_rate_pct: 0,
        findings_30d: 0,
        agents: [],
        findings_by_category: [],
      };
    }

    // Which agents use this skill?
    const agentLinks = await this.db
      .select({ agent: t.agents })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, skillId),
          eq(t.agents.workspaceId, workspaceId),
        ),
      );

    const agents = agentLinks.map((r) => ({ id: r.agent.id, name: r.agent.name }));

    if (agents.length === 0) {
      return {
        used_by: 0,
        pull_frequency_pct: 0,
        accept_rate_pct: 0,
        findings_30d: 0,
        agents: [],
        findings_by_category: [],
      };
    }

    const agentIds = agents.map((a) => a.id);

    // Total runs by these agents
    const [totalRunsRow] = await this.db
      .select({ cnt: count() })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          sql`${t.agentRuns.agentId} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
        ),
      );
    const totalRuns = totalRunsRow?.cnt ?? 0;

    // Reviews created in the last 30 days by these agents
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [recentRunsRow] = await this.db
      .select({ cnt: count() })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          sql`${t.agentRuns.agentId} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          sql`${t.agentRuns.ranAt} >= ${thirtyDaysAgo.toISOString()}`,
        ),
      );

    // Findings from these agents' reviews (last 30 days)
    const recentFindings = await this.db
      .select({ category: t.findings.category })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          sql`${t.agentRuns.agentId} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          sql`${t.agentRuns.ranAt} >= ${thirtyDaysAgo.toISOString()}`,
        ),
      );

    const findings_30d = recentFindings.length;

    // Category breakdown
    const catMap = new Map<string, number>();
    for (const f of recentFindings) {
      const cat = f.category ?? 'other';
      catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
    }
    const findings_by_category = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, cnt]) => ({ category, count: cnt }));

    // Pull frequency: % of runs that happened (simple heuristic)
    const pullFrequency = totalRuns > 0 ? Math.round(((recentRunsRow?.cnt ?? 0) / totalRuns) * 100) : 0;

    return {
      used_by: agents.length,
      pull_frequency_pct: pullFrequency,
      accept_rate_pct: 0, // acceptance tracking is L03+
      findings_30d,
      agents,
      findings_by_category,
    };
  }

  // ---- Eval cases (owner_kind='skill') ------------------------------------

  async listEvalCases(workspaceId: string, skillId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, skillId),
        ),
      );
  }

  async insertEvalCase(values: {
    workspaceId: string;
    skillId: string;
    name: string;
    input_diff: string;
    expected_output: unknown;
    notes?: string;
    /**
     * Provenance (AC-8) — optional, additive: existing callers that omit it
     * (e.g. the manual-case path) are unaffected (`inputMeta` stays `null`).
     * The skill-eval `createCaseFromFinding` path passes
     * `{ source: 'finding', source_finding_id, source_pr_number }` here so the
     * persisted row (not just the returned DTO) carries provenance.
     */
    input_meta?: unknown;
  }): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'skill',
        ownerId: values.skillId,
        name: values.name,
        inputDiff: values.input_diff,
        expectedOutput: values.expected_output as object,
        inputMeta: (values.input_meta as object | undefined) ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Full-replacement edit of a skill-owned eval case (AC-39). Mirrors
   * `insertEvalCase`'s shape/signature — same `expected_output: unknown`
   * passthrough for the skill-eval `{practices, grounding, threshold}` JSON.
   * Scoped by `workspaceId` + `owner_kind='skill'` + `owner_id` (skillId) so a
   * same-workspace caseId belonging to a DIFFERENT skill (or an agent-owned
   * case) cannot be edited via this method — returns `undefined` in that case.
   */
  async updateEvalCase(
    workspaceId: string,
    skillId: string,
    caseId: string,
    values: {
      name: string;
      input_diff: string;
      expected_output: unknown;
      notes?: string;
    },
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        name: values.name,
        inputDiff: values.input_diff,
        expectedOutput: values.expected_output as object,
        notes: values.notes ?? null,
      })
      .where(
        and(
          eq(t.evalCases.id, caseId),
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
          eq(t.evalCases.ownerId, skillId),
        ),
      )
      .returning();
    return row;
  }

  async deleteEvalCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(
        and(
          eq(t.evalCases.id, caseId),
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'skill'),
        ),
      )
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Latest eval run for each case (for the Evals tab pass/fail status). */
  async latestEvalRuns(caseIds: string[]): Promise<Map<string, typeof t.evalRuns.$inferSelect>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        sql`${t.evalRuns.caseId} = ANY(ARRAY[${sql.join(caseIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      )
      .orderBy(desc(t.evalRuns.ranAt));
    const map = new Map<string, typeof t.evalRuns.$inferSelect>();
    for (const r of rows) {
      if (!map.has(r.caseId)) map.set(r.caseId, r);
    }
    return map;
  }
}
