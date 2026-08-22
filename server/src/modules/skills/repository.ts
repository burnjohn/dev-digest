import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  sql,
} from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { SkillRow } from "../../db/rows.js";
import type { ThreatLevel } from "./scanner.js";
export type { SkillRow };

/**
 * A1 — skills data-access. Owns `skills`, `skill_versions` tables.
 * Workspace-scoped throughout.
 */

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: string;
  source: string;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
  threatLevel?: ThreatLevel;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: string;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface SkillWithStats {
  skill: SkillRow;
  agent_count: number;
  pull_frequency_pct: number;
  accept_rate_pct: number;
}

export interface SkillStats {
  agent_count: number;
  pull_frequency_pct: number;
  accept_rate_pct: number;
  findings_30d: number;
  agents: Array<{ id: string; name: string }>;
  findings_by_category: Record<string, number>;
}

export interface SkillVersionRow {
  skillId: string;
  version: number;
  body: string;
  createdAt: Date;
}

const INITIAL_SKILL_VERSION = 1;

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
  }

  /** List skills with denormalized agent_count. pull_frequency_pct / accept_rate_pct are stubbed 0 for MVP. */
  async listWithStats(workspaceId: string): Promise<SkillWithStats[]> {
    const rows = await this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));

    if (rows.length === 0) return [];

    const skillIds = rows.map((r) => r.id);

    // agent_count per skill via subquery
    const agentCounts = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        count: count(t.agentSkills.agentId),
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);

    const countMap = new Map<string, number>(
      agentCounts.map((r) => [r.skillId, r.count]),
    );

    return rows.map((skill) => ({
      skill,
      agent_count: countMap.get(skill.id) ?? 0,
      pull_frequency_pct: 0,
      accept_rate_pct: 0,
    }));
  }

  async getById(
    workspaceId: string,
    id: string,
  ): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND snapshot version 1 into skill_versions. */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type as "rubric" | "convention" | "security" | "custom",
        source: values.source as
          | "manual"
          | "imported_url"
          | "extracted"
          | "community",
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        ...(values.evidenceFiles !== undefined
          ? { evidenceFiles: values.evidenceFiles }
          : {}),
        ...(values.threatLevel !== undefined
          ? { threatLevel: values.threatLevel }
          : {}),
      })
      .returning();
    await this.snapshotVersion(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. Only changing `body` bumps version and snapshots skill_versions.
   * Changing name/description/enabled/type does NOT bump version.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged =
      patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.type !== undefined
          ? {
              type: patch.type as
                | "rubric"
                | "convention"
                | "security"
                | "custom",
            }
          : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined
          ? { evidenceFiles: patch.evidenceFiles }
          : {}),
        // Body change resets threat level — a re-scan will run asynchronously.
        ...(bodyChanged
          ? { version: nextVersion, threatLevel: "unknown" as const }
          : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row)
      await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    const rows = await this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
    return rows.map((r) => ({
      skillId: r.skillId,
      version: r.version,
      body: r.body,
      createdAt: r.createdAt,
    }));
  }

  async stats(
    workspaceId: string,
    id: string,
  ): Promise<SkillStats | undefined> {
    const skill = await this.getById(workspaceId, id);
    if (!skill) return undefined;

    // Agents linked to this skill (workspace-scoped via JOIN agents)
    const linkedAgents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(
          eq(t.agentSkills.skillId, id),
          eq(t.agents.workspaceId, workspaceId),
        ),
      );

    const agentIds = linkedAgents.map((a) => a.id);

    // findings_30d: findings from reviews produced by runs of agents with this skill
    let findings_30d = 0;
    const findings_by_category: Record<string, number> = {};

    // accept_rate_pct: % of agent_runs (for agents with this skill) where review verdict = 'approved'
    let accept_rate_pct = 0;

    // pull_frequency_pct: % of workspace PRs where any agent with this skill ran
    let pull_frequency_pct = 0;

    if (agentIds.length > 0) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // findings in last 30 days
      const findingRows = await this.db
        .select({ category: t.findings.category })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
        .where(
          and(
            inArray(t.agentRuns.agentId, agentIds),
            gte(t.agentRuns.ranAt, thirtyDaysAgo),
          ),
        );

      findings_30d = findingRows.length;
      for (const f of findingRows) {
        findings_by_category[f.category] =
          (findings_by_category[f.category] ?? 0) + 1;
      }

      // accept_rate_pct: runs where verdict = 'approved' / total runs
      const [runStats] = await this.db
        .select({
          total: count(t.agentRuns.id),
          approved: count(
            sql`CASE WHEN ${t.reviews.verdict} = 'approved' THEN 1 END`,
          ),
        })
        .from(t.agentRuns)
        .leftJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
        .where(inArray(t.agentRuns.agentId, agentIds));

      if (runStats && runStats.total > 0) {
        accept_rate_pct = Math.round(
          (runStats.approved / runStats.total) * 100,
        );
      }

      // pull_frequency_pct: distinct prIds from runs / total PRs in workspace
      const [prRunCount] = await this.db
        .select({ covered: countDistinct(t.agentRuns.prId) })
        .from(t.agentRuns)
        .where(inArray(t.agentRuns.agentId, agentIds));

      const [totalPrCount] = await this.db
        .select({ total: count(t.pullRequests.id) })
        .from(t.pullRequests)
        .where(eq(t.pullRequests.workspaceId, workspaceId));

      if (totalPrCount && totalPrCount.total > 0 && prRunCount) {
        pull_frequency_pct = Math.round(
          (prRunCount.covered / totalPrCount.total) * 100,
        );
      }
    }

    return {
      agent_count: linkedAgents.length,
      pull_frequency_pct,
      accept_rate_pct,
      findings_30d,
      agents: linkedAgents,
      findings_by_category,
    };
  }

  /**
   * Restore a skill's body from a historical version. Loads body from skill_versions
   * where version=N, then updates the skill (bumps version, snapshots).
   */
  async restore(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const [versionRow] = await this.db
      .select()
      .from(t.skillVersions)
      .where(
        and(
          eq(t.skillVersions.skillId, id),
          eq(t.skillVersions.version, version),
        ),
      );

    if (!versionRow) return undefined;

    return this.update(workspaceId, id, { body: versionRow.body });
  }

  private async snapshotVersion(
    skillId: string,
    version: number,
    body: string,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  async updateThreatLevel(id: string, threatLevel: ThreatLevel): Promise<void> {
    await this.db
      .update(t.skills)
      .set({ threatLevel })
      .where(eq(t.skills.id, id));
  }
}
